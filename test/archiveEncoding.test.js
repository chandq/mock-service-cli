const test = require('tap').test;
const {
  createWriteStream,
  existsSync,
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync
} = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const archiver = require('archiver');
const tarStream = require('tar-stream');
const { path7za } = require('7zip-bin');
const { ArchiveService } = require('../src/lib/archiveService');
const lightArchiveProvider = require('../src/lib/archiveProviders/light');
const ultraArchiveProvider = require('../src/lib/archiveProviders/ultra');

function createService(root) {
  const resolvePath = inputPath => path.resolve(root, String(inputPath || '/').replace(/^\/+/, ''));
  return new ArchiveService({
    rootPath: realpathSync(root),
    resolvePath,
    getChildPath: (parentPath, name) => path.resolve(resolvePath(parentPath), name)
  });
}

// Windows keeps temporary directories busy for a moment after aborted writes
// and antivirus scans. Retry, then leave the OS temp directory for the runner
// to reclaim instead of failing an otherwise valid test.
function removeTempDir(targetPath) {
  try {
    rmSync(targetPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    // Best-effort cleanup: temp directories are outside the workspace.
  }
}

function waitForJob(service, id) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const job = service.getJob(id);
      if (!['completed', 'failed', 'cancelled'].includes(job.status)) return;
      clearInterval(timer);
      if (job.status === 'completed') resolve(job);
      else reject(new Error(job.error || 'Archive job did not complete'));
    }, 20);
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Builds a minimal STORED ZIP. Name bytes and the EFS (UTF-8) flag are controllable so
// archives produced by Chinese Windows tools can be reproduced without iconv helpers.
// entries: [{ name: Buffer, data: Buffer, directory?: boolean, utf8Flag?: boolean, extra?: Buffer }]
function buildStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.utf8Flag ? 0x800 : 0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, entry.name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.utf8Flag ? 0x800 : 0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(entry.extra ? entry.extra.length : 0, 30);
    const externalAttributes =
      entry.externalAttributes !== undefined
        ? entry.externalAttributes
        : entry.directory
          ? 0x41ff0010
          : 0;
    central.writeUInt32LE(externalAttributes, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, entry.name, entry.extra || Buffer.alloc(0));

    offset += local.length + entry.name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function unicodePathExtra(rawName, utf8Name) {
  const payload = Buffer.concat([Buffer.from([1]), Buffer.alloc(4), Buffer.from(utf8Name, 'utf8')]);
  payload.writeUInt32LE(crc32(rawName), 1);
  const extra = Buffer.alloc(4 + payload.length);
  extra.writeUInt16LE(0x7075, 0);
  extra.writeUInt16LE(payload.length, 2);
  payload.copy(extra, 4);
  return extra;
}

// GBK byte sequences (verified with iconv): 中文目录 / 中文文件.txt
const GBK_DIRECTORY_NAME = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xc4, 0xbf, 0xc2, 0xbc, 0x2f]);
const GBK_FILE_NAME = Buffer.from([
  0xd6, 0xd0, 0xce, 0xc4, 0xc4, 0xbf, 0xc2, 0xbc, 0x2f,
  0xd6, 0xd0, 0xce, 0xc4, 0xce, 0xc4, 0xbc, 0xfe, 0x2e, 0x74, 0x78, 0x74
]);

test('ZIP providers decode Chinese entry names from legacy GBK archives', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-gbk-'));
  try {
    const archivePath = path.join(root, 'gbk.zip');
    writeFileSync(
      archivePath,
      buildStoredZip([
        { name: GBK_DIRECTORY_NAME, data: Buffer.alloc(0), directory: true },
        { name: GBK_FILE_NAME, data: Buffer.from('中文内容', 'utf8') }
      ])
    );

    for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
      const entries = await provider.listEntries(archivePath);
      t.same(
        entries.map(entry => entry.path),
        ['中文目录', '中文目录/中文文件.txt'],
        `${provider.capabilities.edition} provider decodes GBK names without the EFS flag`
      );
      t.notOk(
        entries.some(entry => entry.path.endsWith('/')),
        `${provider.capabilities.edition} provider strips trailing slashes from directory paths`
      );

      const output = path.join(root, `out-${provider.capabilities.edition}`);
      mkdirSync(output);
      await provider.extract({ progress: { processedEntries: 0, totalEntries: 2 } }, archivePath, output);
      const extractedFile = path.join(output, '中文目录', '中文文件.txt');
      t.ok(existsSync(extractedFile), `${provider.capabilities.edition} provider writes the decoded Chinese path`);
      t.equal(readFileSync(extractedFile, 'utf8'), '中文内容', `${provider.capabilities.edition} provider keeps file contents intact`);
    }
  } finally {
    removeTempDir(root);
  }
});

test('ZIP providers fall back to UTF-8 and the Unicode extra when the EFS flag is absent', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-utf8noflag-'));
  try {
    const utf8NoFlagPath = path.join(root, 'utf8-no-flag.zip');
    writeFileSync(
      utf8NoFlagPath,
      buildStoredZip([{ name: Buffer.from('日本語ファイル.txt', 'utf8'), data: Buffer.from('x') }])
    );
    t.equal(
      (await lightArchiveProvider.listEntries(utf8NoFlagPath))[0].path,
      '日本語ファイル.txt',
      'detects UTF-8 encoded names that do not set the EFS flag'
    );

    const infoZipPath = path.join(root, 'infozip.zip');
    const rawName = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x74, 0x78, 0x74]); // GBK 中文.txt
    writeFileSync(
      infoZipPath,
      buildStoredZip([
        { name: rawName, data: Buffer.from('y'), extra: unicodePathExtra(rawName, 'Unicode中文.txt') }
      ])
    );
    t.equal(
      (await lightArchiveProvider.listEntries(infoZipPath))[0].path,
      'Unicode中文.txt',
      'trusts the Info-ZIP Unicode path extra when its CRC matches'
    );
  } finally {
    removeTempDir(root);
  }
});

test('ArchiveService previews and extracts GBK ZIP archives through the full job flow', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-gbk-service-'));
  const service = createService(root);
  try {
    writeFileSync(
      path.join(root, 'gbk.zip'),
      buildStoredZip([
        { name: GBK_DIRECTORY_NAME, data: Buffer.alloc(0), directory: true },
        { name: GBK_FILE_NAME, data: Buffer.from('中文内容', 'utf8') }
      ])
    );

    const preview = await service.listArchive('/gbk.zip');
    t.same(
      preview.entries.map(entry => entry.path),
      ['中文目录', '中文目录/中文文件.txt'],
      'preview shows decoded Chinese names'
    );

    const job = service.startJob('extract', { path: '/gbk.zip', destinationPath: '/' });
    await waitForJob(service, job.id);
    t.ok(existsSync(path.join(root, '中文目录', '中文文件.txt')), 'extracts to the decoded Chinese path');
  } finally {
    removeTempDir(root);
  }
});

test('ArchiveService rejects unsafe entry paths in legacy encoded ZIP archives', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-zip-traversal-'));
  const service = createService(root);
  try {
    const escapeMarker = `escape-${process.pid}-${Date.now()}.txt`;
    writeFileSync(
      path.join(root, 'evil.zip'),
      buildStoredZip([{ name: Buffer.from(`../${escapeMarker}`, 'ascii'), data: Buffer.from('x') }])
    );
    await t.rejects(service.listArchive('/evil.zip'), /unsafe entry path/, 'rejects traversal entries');
    t.notOk(existsSync(path.join(root, '..', escapeMarker)), 'never writes outside the root');

    writeFileSync(
      path.join(root, 'nul.zip'),
      buildStoredZip([{ name: Buffer.from('bad\0name.txt', 'utf8'), data: Buffer.from('x'), utf8Flag: true }])
    );
    await t.rejects(service.listArchive('/nul.zip'), /unsafe entry path/, 'rejects NUL bytes in entry names');
  } finally {
    removeTempDir(root);
  }
});

test('ArchiveService round-trips Chinese names when creating and extracting archives', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-cjk-roundtrip-'));
  const service = createService(root);
  try {
    mkdirSync(path.join(root, '中文来源'));
    writeFileSync(path.join(root, '中文来源', '中文文件.txt'), 'roundtrip 中文');

    const zipJob = service.startJob('create', {
      sources: ['/中文来源'],
      destinationPath: '/',
      name: '中文压缩包',
      format: 'zip'
    });
    await waitForJob(service, zipJob.id);
    t.ok(existsSync(path.join(root, '中文压缩包.zip')), 'creates a ZIP with a Chinese archive name');

    const zipPreview = await service.listArchive('/中文压缩包.zip');
    t.equal(zipPreview.entries[0].path, '中文来源/中文文件.txt', 'previews Chinese ZIP entries');
    t.equal(
      (await lightArchiveProvider.listEntries(path.join(root, '中文压缩包.zip')))[0].path,
      '中文来源/中文文件.txt',
      'light provider reads the created ZIP with Chinese names'
    );

    const lightOutput = path.join(root, 'light-output');
    mkdirSync(lightOutput);
    await lightArchiveProvider.extract({ progress: { processedEntries: 0, totalEntries: 1 } }, path.join(root, '中文压缩包.zip'), lightOutput);
    t.equal(
      readFileSync(path.join(lightOutput, '中文来源', '中文文件.txt'), 'utf8'),
      'roundtrip 中文',
      'light provider extracts Chinese entries created by the service'
    );

    rmSync(path.join(root, '中文来源'), { recursive: true, force: true });
    const extractJob = service.startJob('extract', { path: '/中文压缩包.zip', destinationPath: '/' });
    await waitForJob(service, extractJob.id);
    t.ok(existsSync(path.join(root, '中文来源', '中文文件.txt')), 'extracts Chinese entries through the service');

    const tarJob = service.startJob('create', {
      sources: ['/中文来源/中文文件.txt'],
      destinationPath: '/',
      name: '中文tar包',
      format: 'tar.gz'
    });
    await waitForJob(service, tarJob.id);
    const tarPreview = await service.listArchive('/中文tar包.tar.gz');
    t.equal(tarPreview.entries[0].path, '中文文件.txt', 'previews Chinese TAR.GZ entries');
    const tarOutput = path.join(root, 'tar-output');
    mkdirSync(tarOutput);
    const tarExtract = service.startJob('extract', { path: '/中文tar包.tar.gz', destinationPath: '/tar-output' });
    await waitForJob(service, tarExtract.id);
    t.ok(
      readdirSync(tarOutput).includes('中文文件.txt'),
      'extracts Chinese TAR.GZ entries'
    );
  } finally {
    removeTempDir(root);
  }
});

// --- RAR4 (LHD_UNICODE) and bundled 7-Zip fixture helpers ---

// Builds the RAR4 LHD_UNICODE name field: NUL-terminated fallback name followed by
// the unrar EncodeFileName stream (HighByte + one flags byte per 4 wchars).
function buildRarUnicodeName(name, fallback) {
  const codes = [];
  const dataBytes = [];
  for (const character of name) {
    const value = character.codePointAt(0);
    if (value < 0x100) {
      codes.push(0);
      dataBytes.push(value);
    } else {
      codes.push(2);
      dataBytes.push(value & 0xff, value >> 8);
    }
  }
  const stream = [0]; // HighByte 0: opcode 0 for ASCII, opcode 2 for full uint16
  let offset = 0;
  for (let index = 0; index < codes.length; index += 4) {
    const group = codes.slice(index, index + 4);
    let flags = 0;
    const groupData = [];
    for (const code of group) {
      flags = (flags << 2) | code;
      if (code === 0) groupData.push(dataBytes[offset++]);
      else {
        groupData.push(dataBytes[offset], dataBytes[offset + 1]);
        offset += 2;
      }
    }
    flags <<= 2 * (4 - group.length);
    stream.push(flags & 0xff, ...groupData);
  }
  return Buffer.concat([Buffer.from(`${fallback}\0`, 'ascii'), Buffer.from(stream)]);
}

// RAR block CRC is the low 16 bits of the standard CRC32 over the block after CRC.
function rarBlockCrc(body) {
  return crc32(body) & 0xffff;
}

function buildRarFileHeader(nameField, data, directory) {
  const body = Buffer.alloc(30); // SIZEOF_FILEHEAD3 minus the leading 2 CRC bytes
  let offset = 0;
  body.writeUInt8(0x74, offset); offset += 1; // HEAD3_FILE
  body.writeUInt16LE(directory ? 0x82e0 : 0x8200, offset); offset += 2; // LONG|UNICODE, dir window bits
  body.writeUInt16LE(32 + nameField.length, offset); offset += 2;
  body.writeUInt32LE(directory ? 0 : data.length, offset); offset += 4; // packed size
  body.writeUInt32LE(directory ? 0 : data.length, offset); offset += 4; // unpacked size
  body.writeUInt8(0, offset); offset += 1; // Windows host OS
  body.writeUInt32LE(directory ? 0 : crc32(data), offset); offset += 4;
  body.writeUInt32LE(0x50640000, offset); offset += 4; // DOS time
  body.writeUInt8(29, offset); offset += 1; // RAR 2.9 version
  body.writeUInt8(0x30, offset); offset += 1; // store
  body.writeUInt16LE(nameField.length, offset); offset += 2;
  body.writeUInt32LE(directory ? 0x10 : 0x20, offset);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(rarBlockCrc(Buffer.concat([body, nameField])));
  return Buffer.concat([crc, body, nameField]);
}

function buildRar4Archive() {
  const marker = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const mainBody = Buffer.from([0x73, 0x00, 0x00, 0x0d, 0x00, 0, 0, 0, 0, 0, 0]);
  const mainCrc = Buffer.alloc(2);
  mainCrc.writeUInt16LE(rarBlockCrc(mainBody));
  const data = Buffer.from('rar 中文内容', 'utf8');
  const directoryHeader = buildRarFileHeader(buildRarUnicodeName('中文目录', 'dir'), Buffer.alloc(0), true);
  const fileHeader = buildRarFileHeader(buildRarUnicodeName('中文目录/中文文件.txt', 'file.txt'), data, false);
  return Buffer.concat([marker, mainCrc, mainBody, directoryHeader, fileHeader, data]);
}

function run7za(args, cwd) {
  if (process.platform !== 'win32') chmodSync(path7za, 0o755);
  const result = spawnSync(path7za, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `7-Zip exited with ${result.status}`);
}

function createPlainTar(targetPath, data) {
  return new Promise((resolve, reject) => {
    const archive = archiver('tar');
    const output = createWriteStream(targetPath);
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(data, { name: '中文目录/中文文件.txt' });
    archive.finalize();
  });
}

test('ultra provider decodes Chinese names in RAR, 7z, TAR.BZ2, TAR.XZ and plain TAR archives', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-ultra-cjk-'));
  try {
    const fixtures = {};

    const rarPath = path.join(root, 'cn.rar');
    writeFileSync(rarPath, buildRar4Archive());
    fixtures.rar = { filePath: rarPath, content: 'rar 中文内容' };

    const sevenSource = path.join(root, 'seven-src');
    mkdirSync(path.join(sevenSource, '中文目录'), { recursive: true });
    writeFileSync(path.join(sevenSource, '中文目录', '中文文件.txt'), '7z 中文内容');
    const sevenPath = path.join(root, 'cn.7z');
    run7za(['a', '-y', sevenPath, '中文目录'], sevenSource);
    fixtures.sevenz = { filePath: sevenPath, content: '7z 中文内容' };

    const plainTarPath = path.join(root, 'cn.tar');
    await createPlainTar(plainTarPath, Buffer.from('tar 中文内容', 'utf8'));
    fixtures.tar = { filePath: plainTarPath, content: 'tar 中文内容' };

    for (const [type, extension] of [['bzip2', '.tar.bz2'], ['xz', '.tar.xz']]) {
      const compressedPath = path.join(root, `cn${extension}`);
      run7za(['a', '-y', `-t${type}`, compressedPath, plainTarPath]);
      fixtures[type] = { filePath: compressedPath, content: 'tar 中文内容' };
    }

    for (const [label, fixture] of Object.entries(fixtures)) {
      const entries = await ultraArchiveProvider.listEntries(fixture.filePath);
      t.ok(
        entries.some(entry => entry.path === '中文目录/中文文件.txt'),
        `ultra provider lists the Chinese entry from ${label}`
      );
      t.notOk(
        entries.some(entry => entry.path.endsWith('/')),
        `ultra provider strips trailing slashes from ${label} directory paths`
      );

      const output = path.join(root, `out-${label}`);
      mkdirSync(output);
      const job = { progress: { processedEntries: 0, totalEntries: entries.length } };
      await ultraArchiveProvider.extract(job, fixture.filePath, output);
      const extractedFile = path.join(output, '中文目录', '中文文件.txt');
      t.ok(existsSync(extractedFile), `ultra provider extracts the Chinese path from ${label}`);
      t.equal(readFileSync(extractedFile, 'utf8'), fixture.content, `ultra provider keeps ${label} file contents intact`);
    }

    // light provider keeps plain TAR Chinese names working through the shared parser
    const lightTarOutput = path.join(root, 'out-light-tar');
    mkdirSync(lightTarOutput);
    const lightEntries = await lightArchiveProvider.listEntries(plainTarPath);
    t.equal(lightEntries[0].path, '中文目录/中文文件.txt', 'light provider lists plain TAR Chinese names');
    await lightArchiveProvider.extract(
      { progress: { processedEntries: 0, totalEntries: 1 } },
      plainTarPath,
      lightTarOutput
    );
    t.ok(
      existsSync(path.join(lightTarOutput, '中文目录', '中文文件.txt')),
      'light provider extracts plain TAR Chinese names'
    );
  } finally {
    removeTempDir(root);
  }
});

test('ArchiveService previews and extracts RAR4 archives with Chinese names', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-rar-service-'));
  const service = createService(root);
  try {
    writeFileSync(path.join(root, 'cn.rar'), buildRar4Archive());
    const preview = await service.listArchive('/cn.rar');
    t.same(
      preview.entries.map(entry => entry.path),
      ['中文目录', '中文目录/中文文件.txt'],
      'preview shows decoded RAR Chinese names'
    );
    t.ok(preview.entries[0].isDirectory, 'marks the RAR directory entry');

    const job = service.startJob('extract', { path: '/cn.rar', destinationPath: '/' });
    await waitForJob(service, job.id);
    t.ok(existsSync(path.join(root, '中文目录', '中文文件.txt')), 'extracts RAR entries to Chinese paths');
    t.equal(readFileSync(path.join(root, '中文目录', '中文文件.txt'), 'utf8'), 'rar 中文内容', 'keeps RAR contents intact');
  } finally {
    removeTempDir(root);
  }
});

test('archive jobs with Chinese names can be cancelled mid-extraction', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-cancel-cjk-'));
  const service = createService(root);
  try {
    mkdirSync(path.join(root, 'src'));
    for (let index = 0; index < 3000; index++) {
      writeFileSync(path.join(root, 'src', `文件-${index}.bin`), Buffer.alloc(4 * 1024, index % 256));
    }
    for (const format of ['zip', 'tar.gz']) {
      const archiveName = format === 'zip' ? '大包.zip' : '大包.tar.gz';
      const createJob = service.startJob('create', {
        sources: ['/src'],
        destinationPath: '/',
        name: '大包',
        format
      });
      await waitForJob(service, createJob.id);

      const destinationName = `dest-${format === 'zip' ? 'zip' : 'targz'}`;
      mkdirSync(path.join(root, destinationName));
      const extractJob = service.startJob('extract', {
        path: `/${archiveName}`,
        destinationPath: `/${destinationName}`
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      service.cancelJob(extractJob.id);
      for (let attempt = 0; attempt < 600; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        if (['completed', 'failed', 'cancelled'].includes(service.getJob(extractJob.id).status)) break;
      }
      t.equal(service.getJob(extractJob.id).status, 'cancelled', `${format} extraction is cancellable`);
      t.notOk(
        existsSync(path.join(root, destinationName, 'src', '文件-0.bin')),
        `${format} cancellation leaves no committed output`
      );
      t.same(
        readdirSync(path.join(root, destinationName)).filter(name => name.startsWith('.mock-service-cli-archive-')),
        [],
        `${format} cancellation removes the temporary extraction directory`
      );
    }
  } finally {
    removeTempDir(root);
  }
});

test('ultra provider falls back to 7-Zip for Deflate64 ZIP entries', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-deflate64-'));
  try {
    writeFileSync(path.join(root, '中文.txt'), 'deflate64 内容');
    const archivePath = path.join(root, 'd64.zip');
    run7za(['a', '-y', '-tzip', '-mm=Deflate64', archivePath, '中文.txt'], root);

    const entries = await ultraArchiveProvider.listEntries(archivePath);
    t.ok(entries.some(entry => entry.path === '中文.txt'), 'lists Deflate64 entries through the fallback');

    const output = path.join(root, 'out');
    mkdirSync(output);
    await ultraArchiveProvider.extract({ progress: { processedEntries: 0, totalEntries: 1 } }, archivePath, output);
    t.equal(
      readFileSync(path.join(output, '中文.txt'), 'utf8'),
      'deflate64 内容',
      'extracts Deflate64 entries through the fallback'
    );
  } finally {
    removeTempDir(root);
  }
});

test('providers normalize GNU tar ./ markers and trailing-slash directory names', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-gnu-tar-'));
  try {
    const tarPack = tarStream.pack();
    const archivePath = path.join(root, 'gnu.tar');
    const outputStream = createWriteStream(archivePath);
    tarPack.pipe(outputStream);
    await new Promise((resolve, reject) => {
      tarPack.entry({ name: './', type: 'directory' }, error => {
        if (error) return reject(error);
        tarPack.entry({ name: './中文目录/', type: 'directory' }, error2 => {
          if (error2) return reject(error2);
          tarPack.entry({ name: './中文目录/中文文件.txt', type: 'file' }, 'gnu 内容', error3 => {
            if (error3) return reject(error3);
            tarPack.finalize();
            outputStream.on('finish', resolve);
          });
        });
      });
    });

    for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
      const entries = await provider.listEntries(archivePath);
      t.same(
        entries.map(entry => entry.path),
        ['中文目录', '中文目录/中文文件.txt'],
        `${provider.capabilities.edition} provider skips the ./ root marker and strips slashes`
      );
      t.ok(entries[0].isDirectory, `${provider.capabilities.edition} provider marks the directory`);
      t.notOk(entries.some(entry => entry.path.endsWith('/')), `${provider.capabilities.edition} has no trailing slashes`);

      const output = path.join(root, `out-${provider.capabilities.edition}`);
      mkdirSync(output);
      await provider.extract({ progress: { processedEntries: 0, totalEntries: 2 } }, archivePath, output);
      t.ok(
        existsSync(path.join(output, '中文目录', '中文文件.txt')),
        `${provider.capabilities.edition} provider extracts GNU-style TAR entries`
      );
    }
  } finally {
    removeTempDir(root);
  }
});

test('ZIP providers detect directories via external attributes without a trailing slash', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-zip-attrdir-'));
  try {
    const directoryName = Buffer.from('属性目录', 'utf8');
    const fileName = Buffer.from('属性目录/文件.txt', 'utf8');
    const data = Buffer.from('attr 内容', 'utf8');
    writeFileSync(
      path.join(root, 'attr.zip'),
      buildStoredZip([
        { name: directoryName, data: Buffer.alloc(0), utf8Flag: true, directory: true, externalAttributes: 0x10 },
        { name: fileName, data, utf8Flag: true }
      ])
    );

    for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
      const entries = await provider.listEntries(path.join(root, 'attr.zip'));
      t.equal(entries[0].path, '属性目录', `${provider.capabilities.edition} provider keeps the directory name slash-free`);
      t.ok(entries[0].isDirectory, `${provider.capabilities.edition} provider detects the directory via DOS attribute bit`);

      const output = path.join(root, `out-${provider.capabilities.edition}`);
      mkdirSync(output);
      await provider.extract({ progress: { processedEntries: 0, totalEntries: 2 } }, path.join(root, 'attr.zip'), output);
      t.ok(
        existsSync(path.join(output, '属性目录', '文件.txt')),
        `${provider.capabilities.edition} provider extracts files under the attribute-detected directory`
      );
    }
  } finally {
    removeTempDir(root);
  }
});

function buildTarEntries(targetPath, entries) {
  const pack = tarStream.pack();
  const stream = createWriteStream(targetPath);
  pack.pipe(stream);
  return new Promise((resolve, reject) => {
    const write = index => {
      if (index >= entries.length) {
        pack.finalize();
        stream.on('finish', resolve);
        return;
      }
      const item = entries[index];
      const header = { name: item.name, type: item.type || 'file' };
      if (item.linkname) header.linkname = item.linkname;
      pack.entry(header, item.data === undefined ? null : item.data, error => {
        if (error) reject(error);
        else write(index + 1);
      });
    };
    write(0);
  });
}

// Minimal raw TAR writer so entry names can be arbitrary bytes (GBK fixtures).
function buildRawTar(targetPath, entries) {
  const blocks = [];
  for (const entry of entries) {
    const size = entry.data ? entry.data.length : 0;
    const header = Buffer.alloc(512);
    entry.nameBytes.copy(header, 0, 0, Math.min(100, entry.nameBytes.length));
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 'ascii');
    header.fill(0x20, 148, 156);
    header.write(entry.type || '0', 156, 'ascii');
    if (entry.linknameBytes) entry.linknameBytes.copy(header, 157, 0, Math.min(100, entry.linknameBytes.length));
    header.write('ustar\0', 257, 'latin1');
    header.write('00', 263, 'latin1');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    blocks.push(header);
    if (entry.data && entry.data.length) {
      blocks.push(entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  writeFileSync(targetPath, Buffer.concat(blocks));
}

function assertInTreeSymlink(t, linkPath, expectedTarget, expectedContent) {
  const stats = lstatSync(linkPath);
  if (process.platform === 'win32' && !stats.isSymbolicLink()) {
    // Git-style fallback when the account lacks the Windows symlink privilege.
    t.equal(readFileSync(linkPath, 'utf8'), expectedTarget, 'Windows fallback stores the link target');
    return;
  }
  t.ok(stats.isSymbolicLink(), 'restores the entry as a symbolic link');
  t.equal(readlinkSync(linkPath).replace(/\\/g, '/'), expectedTarget, 'keeps the archived link target');
  t.equal(readFileSync(linkPath, 'utf8'), expectedContent, 'link resolves to the archived file');
}

const NODE_STYLE_TAR_ENTRIES = [
  { name: 'lib/', type: 'directory' },
  { name: 'lib/cli.js', data: '#!/usr/bin/env node\n' },
  { name: 'bin/', type: 'directory' },
  { name: 'bin/npm', type: 'symlink', linkname: '../lib/cli.js' },
  { name: '中文说明.txt', data: '说明内容' }
];

test('TAR providers decode legacy GBK entry names through the byte-level decoder', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-tar-gbk-'));
  try {
    const archivePath = path.join(root, 'gbk.tar');
    buildRawTar(archivePath, [
      { nameBytes: GBK_DIRECTORY_NAME, type: '5' },
      { nameBytes: GBK_FILE_NAME, type: '0', data: Buffer.from('tar 中文内容', 'utf8') },
      { nameBytes: Buffer.from('中文说明.txt', 'utf8'), type: '0', data: Buffer.from('utf8 内容', 'utf8') }
    ]);

    for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
      const edition = provider.capabilities.edition;
      const entries = await provider.listEntries(archivePath);
      t.same(
        entries.map(entry => entry.path),
        ['中文目录', '中文目录/中文文件.txt', '中文说明.txt'],
        `${edition} provider decodes GBK TAR names without breaking UTF-8 names`
      );
      const output = path.join(root, `out-${edition}`);
      mkdirSync(output);
      await provider.extract({ progress: { processedEntries: 0, totalEntries: 3 } }, archivePath, output);
      t.equal(
        readFileSync(path.join(output, '中文目录', '中文文件.txt'), 'utf8'),
        'tar 中文内容',
        `${edition} provider extracts GBK TAR names`
      );
      t.equal(readFileSync(path.join(output, '中文说明.txt'), 'utf8'), 'utf8 内容', `${edition} provider keeps UTF-8 names`);
    }
  } finally {
    removeTempDir(root);
  }
});

test('TAR providers restore in-tree symbolic links instead of rejecting the archive', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-tar-link-'));
  try {
    const archivePath = path.join(root, 'node-style.tar');
    await buildTarEntries(archivePath, NODE_STYLE_TAR_ENTRIES);

    for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
      const edition = provider.capabilities.edition;
      const entries = await provider.listEntries(archivePath);
      const symlinkEntry = entries.find(entry => entry.path === 'bin/npm');
      t.ok(symlinkEntry, `${edition} provider lists the symlink entry`);
      t.ok(symlinkEntry && symlinkEntry.isSymbolicLink, `${edition} provider flags the symlink`);

      const output = path.join(root, `out-${edition}`);
      mkdirSync(output);
      await provider.extract({ progress: { processedEntries: 0, totalEntries: entries.length } }, archivePath, output);
      assertInTreeSymlink(t, path.join(output, 'bin', 'npm'), '../lib/cli.js', '#!/usr/bin/env node\n');
      t.ok(existsSync(path.join(output, '中文说明.txt')), `${edition} provider still extracts regular entries`);
    }
  } finally {
    removeTempDir(root);
  }
});

test('TAR providers reject symbolic links whose target escapes the extraction folder', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-tar-link-escape-'));
  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  const cases = [
    { label: 'relative escape', name: 'a/up', linkname: '../../outside' },
    { label: 'absolute path', name: 'a/absolute', linkname: '/etc/passwd' },
    { label: 'drive path', name: 'a/drive', linkname: 'C:\\Windows\\win.ini' },
    { label: 'UNC path', name: 'a/unc', linkname: '\\\\server\\share\\file' }
  ];
  try {
    for (const [index, item] of cases.entries()) {
      const archivePath = path.join(root, `escape-${index}.tar`);
      await buildTarEntries(archivePath, [{ name: item.name, type: 'symlink', linkname: item.linkname }]);
      for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
        const output = path.join(root, `out-${provider.capabilities.edition}-${index}`);
        if (!existsSync(output)) mkdirSync(output);
        await t.rejects(
          provider.extract({ progress: { processedEntries: 0, totalEntries: 1 } }, archivePath, output),
          /pointing outside the extraction folder/,
          `${provider.capabilities.edition} provider rejects ${item.linkname}`
        );
        t.notOk(existsSync(path.join(output, item.name)), 'never materializes the escaping link');
      }
      t.same(readdirSync(outside), [], 'never writes outside the destination');
    }
  } finally {
    removeTempDir(root);
  }
});

test('ArchiveService extracts in-tree symlinks and commits nothing when a link escapes', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-service-link-'));
  const service = createService(root);
  try {
    const safePath = path.join(root, 'safe.tar');
    await buildTarEntries(safePath, NODE_STYLE_TAR_ENTRIES);
    mkdirSync(path.join(root, 'dest'));
    mkdirSync(path.join(root, 'dest-escape'));

    const preview = await service.listArchive('/safe.tar');
    t.ok(preview.entries.some(entry => entry.path === 'bin/npm' && entry.isSymbolicLink), 'previews the symlink entry');

    const safeJob = service.startJob('extract', { path: '/safe.tar', destinationPath: '/dest' });
    await waitForJob(service, safeJob.id);
    assertInTreeSymlink(t, path.join(root, 'dest', 'bin', 'npm'), '../lib/cli.js', '#!/usr/bin/env node\n');
    t.ok(existsSync(path.join(root, 'dest', '中文说明.txt')), 'commits regular entries alongside links');

    const evilPath = path.join(root, 'evil.tar');
    await buildTarEntries(evilPath, [{ name: 'bin/evil', type: 'symlink', linkname: '../../../etc/passwd' }]);
    const evilJob = service.startJob('extract', { path: '/evil.tar', destinationPath: '/dest-escape' });
    await t.rejects(waitForJob(service, evilJob.id), /pointing outside/, 'fails the job for escaping links');
    t.same(readdirSync(path.join(root, 'dest-escape')), [], 'leaves the destination untouched');
    t.notOk(existsSync(path.join(root, 'etc')), 'never creates link targets outside the destination');
  } finally {
    removeTempDir(root);
  }
});

test('ArchiveService refuses to replace a dangling destination symlink', async t => {
  if (process.platform === 'win32') {
    t.skip('dangling symlink creation requires the Windows symlink privilege');
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-dangling-conflict-'));
  const service = createService(root);
  try {
    writeFileSync(
      path.join(root, 'single.zip'),
      buildStoredZip([{ name: Buffer.from('占用.txt', 'utf8'), data: Buffer.from('x'), utf8Flag: true }])
    );
    symlinkSync('missing-target', path.join(root, '占用.txt'));

    const job = service.startJob('extract', { path: '/single.zip', destinationPath: '/' });
    await t.rejects(waitForJob(service, job.id), /Destination already contains/, 'reports the destination conflict');
    t.ok(lstatSync(path.join(root, '占用.txt')).isSymbolicLink(), 'keeps the existing dangling symlink');
  } finally {
    removeTempDir(root);
  }
});

test('ZIP providers restore in-tree symbolic links and reject escaping targets', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-zip-link-'));
  try {
    const archivePath = path.join(root, 'links.zip');
    writeFileSync(
      archivePath,
      buildStoredZip([
        { name: Buffer.from('正常文件.txt', 'utf8'), data: Buffer.from('正常内容'), utf8Flag: true },
        {
          name: Buffer.from('链接.txt', 'utf8'),
          data: Buffer.from('正常文件.txt'),
          utf8Flag: true,
          externalAttributes: (0o120777 << 16) >>> 0
        }
      ])
    );

    for (const provider of [lightArchiveProvider, ultraArchiveProvider]) {
      const edition = provider.capabilities.edition;
      const entries = await provider.listEntries(archivePath);
      t.ok(
        entries.some(entry => entry.path === '链接.txt' && entry.isSymbolicLink),
        `${edition} provider flags the ZIP symlink entry`
      );
      const output = path.join(root, `out-${edition}`);
      mkdirSync(output);
      await provider.extract({ progress: { processedEntries: 0, totalEntries: 2 } }, archivePath, output);
      assertInTreeSymlink(t, path.join(output, '链接.txt'), '正常文件.txt', '正常内容');
    }

    const escapingPath = path.join(root, 'escaping.zip');
    writeFileSync(
      escapingPath,
      buildStoredZip([
        {
          name: Buffer.from('逃逸链接.txt', 'utf8'),
          data: Buffer.from('../../outside.txt'),
          utf8Flag: true,
          externalAttributes: (0o120777 << 16) >>> 0
        }
      ])
    );
    const evilOutput = path.join(root, 'out-evil');
    mkdirSync(evilOutput);
    await t.rejects(
      lightArchiveProvider.extract({ progress: { processedEntries: 0, totalEntries: 1 } }, escapingPath, evilOutput),
      /pointing outside the extraction folder/,
      'rejects ZIP links pointing outside'
    );
    t.notOk(existsSync(path.join(evilOutput, '逃逸链接.txt')), 'never creates the escaping ZIP link');
  } finally {
    removeTempDir(root);
  }
});

test('7-Zip expanded archives validate link targets before extraction', async t => {
  if (process.platform === 'win32') {
    t.skip('7-Zip symlink fixtures require a Unix host');
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-7zip-link-'));
  const service = createService(root);
  try {
    const source = path.join(root, 'source');
    mkdirSync(path.join(source, 'lib'), { recursive: true });
    writeFileSync(path.join(source, 'lib', 'target.js'), 'console.log(1)');
    symlinkSync('lib/target.js', path.join(source, 'link.js'));
    const archivePath = path.join(root, 'safe.7z');
    run7za(['a', '-y', '-t7z', archivePath, 'source'], root);

    const entries = await ultraArchiveProvider.listEntries(archivePath);
    t.ok(entries.some(entry => entry.path === 'source/link.js' && entry.isSymbolicLink), 'lists the 7z symlink entry');

    mkdirSync(path.join(root, 'dest'));
    const safeJob = service.startJob('extract', { path: '/safe.7z', destinationPath: '/dest' });
    await waitForJob(service, safeJob.id);
    assertInTreeSymlink(t, path.join(root, 'dest', 'source', 'link.js'), 'lib/target.js', 'console.log(1)');

    const evilSource = path.join(root, 'evil-source');
    mkdirSync(evilSource);
    symlinkSync('/etc/passwd', path.join(evilSource, 'passwd'));
    const evilPath = path.join(root, 'evil.7z');
    run7za(['a', '-y', '-t7z', evilPath, 'evil-source'], root);
    mkdirSync(path.join(root, 'dest-evil'));
    const evilJob = service.startJob('extract', { path: '/evil.7z', destinationPath: '/dest-evil' });
    await t.rejects(waitForJob(service, evilJob.id), /pointing outside/, 'rejects absolute 7z links before extraction');
    t.same(readdirSync(path.join(root, 'dest-evil')), [], 'leaves the 7z destination untouched');
  } finally {
    removeTempDir(root);
  }
});
