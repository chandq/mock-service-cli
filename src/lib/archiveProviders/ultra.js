const { chmodSync, realpathSync } = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { createGunzip } = require('zlib');
const { path7za } = require('7zip-bin');
const { createExtractorFromFile } = require('node-unrar-js');
const tarArchive = require('./tarArchive');
const zipArchive = require('./zipArchive');
const {
  createArchiveError,
  decodeArchiveNameBytes,
  hasArchiveExtension,
  isSafeArchiveEntry,
  resolveSafeLinkTarget
} = require('../archiveShared');

const extensions = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tgz',
  '.tbz2',
  '.tbz',
  '.txz',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.lzma',
  '.lz',
  '.z'
];
const capabilities = {
  edition: 'ultra',
  createFormats: ['zip', 'tar.gz'],
  readExtensions: extensions.map(extension => extension.slice(1))
};
const RAR_EXTRACT_WORKER = `
  const { parentPort, workerData } = require('worker_threads');
  const { createExtractorFromFile } = require('node-unrar-js');
  (async () => {
    const extractor = await createExtractorFromFile({ filepath: workerData.sourcePath, targetPath: workerData.targetPath });
    const extracted = extractor.extract();
    [...extracted.files];
    parentPort.postMessage({ success: true });
  })().catch(error => parentPort.postMessage({ error: error.message }));
`;

function isArchivePath(filePath) {
  return hasArchiveExtension(filePath, extensions);
}

function isGzipTar(filePath) {
  return /\.(tar\.gz|tgz)$/i.test(filePath);
}

function isPlainTar(filePath) {
  return /\.tar$/i.test(filePath);
}

// Node core has no bzip2/xz decoder: 7-Zip peels that layer to stdout and tar-stream
// parses the TAR inline, so PAX/UTF-8 names are decoded without temporary files.
function isForeignCompressedTar(filePath) {
  return /\.(tar\.bz2|tbz|tbz2|tar\.xz|txz)$/i.test(filePath);
}

const UNIX_MODE_PATTERN = /^[dlbcps-][rwxStTs-]{9}$/;

// p7zip prints Unix entries as "A_ lrwxr-xr-x"; Windows builds only expose the
// DOS attribute string, so both layouts feed the directory/symlink flags.
function read7ZipUnixMode(attributes) {
  return (
    String(attributes || '')
      .split(/\s+/)
      .find(part => UNIX_MODE_PATTERN.test(part)) || ''
  );
}

function parse7ZipList(output) {
  const separator = output.indexOf('----------');
  if (separator < 0) return [];
  const blocks = output
    .slice(separator + '----------'.length)
    .split(/\r?\n\r?\n/)
    .map(block => {
      const values = {};
      block.split(/\r?\n/).forEach(line => {
        const index = line.indexOf(' = ');
        if (index > 0) values[line.slice(0, index)] = line.slice(index + 3);
      });
      return values;
    })
    .filter(values => values.Path);

  return blocks.map(values => {
    const attributes = String(values.Attributes || '');
    const unixMode = read7ZipUnixMode(attributes);
    return {
      path: values.Path.replace(/\\/g, '/').replace(/\/+$/, ''),
      isDirectory: values.Folder === '+' || unixMode.startsWith('d') || (!unixMode && attributes.startsWith('D')),
      isSymbolicLink: unixMode.startsWith('l'),
      linkTarget: values['Symbolic Link'] || null,
      size: Number(values.Size || 0),
      packedSize: Number(values['Packed Size'] || 0),
      encrypted: values.Encrypted === '+',
      modified: values.Modified || null,
      attributes
    };
  });
}

function run7Zip(args, onProcess) {
  return new Promise((resolve, reject) => {
    try {
      // npm may unpack the bundled binary without its executable mode on Unix.
      if (process.platform !== 'win32') chmodSync(path7za, 0o755);
    } catch (error) {
      return reject(createArchiveError(`Unable to prepare bundled 7-Zip binary: ${error.message}`, 500));
    }
    const child = spawn(path7za, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    if (onProcess) onProcess(child);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) return resolve(stdout);
      reject(createArchiveError(stderr.trim() || `7-Zip exited with code ${code}`, 422));
    });
  });
}

// Streams the inner TAR of a .tar.bz2/.tar.xz archive from 7-Zip stdout.
function createSevenZipTarSource(filePath, onProcess) {
  if (process.platform !== 'win32') {
    try {
      chmodSync(path7za, 0o755);
    } catch (error) {
      throw createArchiveError(`Unable to prepare bundled 7-Zip binary: ${error.message}`, 500);
    }
  }
  const child = spawn(path7za, ['x', '-y', '-so', '--', filePath], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (onProcess) onProcess(child);
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  child.once('error', error => child.stdout.destroy(error));
  child.once('close', code => {
    if (code !== 0 && !child.stdout.destroyed) {
      child.stdout.destroy(
        createArchiveError(stderr.trim() || `7-Zip exited with code ${code}`, 422)
      );
    }
  });
  return { input: child.stdout, streams: [child.stdout, child] };
}

async function list7Zip(fullPath) {
  // -sccUTF-8 keeps non-ASCII entry names stable when the Windows console
  // codepage is GBK or another OEM charset.
  const output = await run7Zip(['l', '-slt', '-sccUTF-8', '--', fullPath]);
  return parse7ZipList(output);
}

// Reads a single entry through stdout. 7-Zip 16.02 has no listing field for
// symlink targets, but extraction restores absolute links, so link targets must
// be validated before the archive is expanded.
function read7ZipEntry(archivePath, entryPath, maxBytes, onProcess) {
  const limit = maxBytes || 4096;
  return new Promise((resolve, reject) => {
    try {
      if (process.platform !== 'win32') chmodSync(path7za, 0o755);
    } catch (error) {
      return reject(createArchiveError(`Unable to prepare bundled 7-Zip binary: ${error.message}`, 500));
    }
    const child = spawn(path7za, ['x', '-so', '-y', '--', archivePath, entryPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (onProcess) onProcess(child);
    const chunks = [];
    let length = 0;
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > limit) {
        finish(reject, createArchiveError('Archive contains a symbolic link with an invalid target', 422));
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.once('error', error => finish(reject, error));
    child.once('close', code => {
      if (code === 0) finish(resolve, Buffer.concat(chunks));
      else finish(reject, createArchiveError(stderr.trim() || `7-Zip exited with code ${code}`, 422));
    });
  });
}

// Pre-flight link validation for every archive expanded by the 7-Zip binary
// (.7z, Deflate64 ZIP, single-file streams). The extraction itself is delegated
// to 7-Zip, so rejecting unsafe targets before spawning keeps writes inside the
// temporary destination.
async function assertSevenZipSymlinksSafe(job, archivePath, targetPath) {
  const links = (await list7Zip(archivePath)).filter(entry => entry.isSymbolicLink);
  if (!links.length) return;
  const rootRealPath = realpathSync(targetPath);
  for (const entry of links) {
    if (job && job.cancelled) throw createArchiveError('Archive job cancelled', 499);
    if (!isSafeArchiveEntry(entry.path)) {
      throw createArchiveError('Archive contains an unsafe entry path', 422);
    }
    const target =
      entry.linkTarget ||
      decodeArchiveNameBytes(
        await read7ZipEntry(archivePath, entry.path, 4096, child => {
          if (job) job.child = child;
        })
      );
    if (job) job.child = null;
    resolveSafeLinkTarget(rootRealPath, path.join(rootRealPath, entry.path), target);
  }
}

async function listRar(fullPath) {
  const extractor = await createExtractorFromFile({ filepath: fullPath });
  const list = extractor.getFileList();
  if (list.arcHeader.flags && list.arcHeader.flags.headerEncrypted) {
    throw createArchiveError('Encrypted archives are not supported', 422);
  }
  return [...list.fileHeaders].map(header => ({
    path: header.name.replace(/\\/g, '/').replace(/\/+$/, ''),
    isDirectory: Boolean(header.flags && header.flags.directory),
    size: Number(header.unpSize || 0),
    packedSize: Number(header.packSize || 0),
    encrypted: Boolean(header.flags && header.flags.encrypted),
    modified: header.time || null,
    attributes: ''
  }));
}

async function listZip(fullPath) {
  // Deflate64 and other exotic methods are outside yauzl's range; keep 7-Zip as fallback.
  if (await zipArchive.isSupportedArchive(fullPath)) return zipArchive.listEntries(fullPath);
  return list7Zip(fullPath);
}

async function listEntries(fullPath) {
  if (fullPath.toLowerCase().endsWith('.zip')) return listZip(fullPath);
  if (isPlainTar(fullPath)) return tarArchive.listEntries(fullPath);
  if (isGzipTar(fullPath)) {
    return tarArchive.listEntries(fullPath, tarArchive.createPipedSource(createGunzip));
  }
  if (isForeignCompressedTar(fullPath)) {
    return tarArchive.listEntries(fullPath, file => createSevenZipTarSource(file));
  }
  if (path.extname(fullPath).toLowerCase() === '.rar') return listRar(fullPath);
  return list7Zip(fullPath);
}

async function extractRar(job, sourcePath, targetPath) {
  await new Promise((resolve, reject) => {
    const worker = new Worker(RAR_EXTRACT_WORKER, { eval: true, workerData: { sourcePath, targetPath } });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      job.child = null;
      callback(value);
    };
    job.child = { kill: () => worker.terminate() };
    worker.on('message', message => {
      if (message && message.success) finish(resolve);
      else finish(reject, createArchiveError((message && message.error) || 'RAR extraction failed', 422));
    });
    worker.on('error', error => finish(reject, error));
    worker.on('exit', code => {
      if (!settled && code !== 0) {
        const message = job.cancelled ? 'Archive job cancelled' : 'RAR extraction stopped';
        finish(reject, createArchiveError(message, 499));
      }
    });
  });
}

async function extractZip(job, sourcePath, targetPath) {
  if (await zipArchive.isSupportedArchive(sourcePath)) {
    return zipArchive.extract(job, sourcePath, targetPath);
  }
  await assertSevenZipSymlinksSafe(job, sourcePath, targetPath);
  await run7Zip(['x', '-y', `-o${targetPath}`, '--', sourcePath], child => {
    job.child = child;
  });
}

async function extract(job, sourcePath, targetPath) {
  if (sourcePath.toLowerCase().endsWith('.zip')) return extractZip(job, sourcePath, targetPath);
  if (isPlainTar(sourcePath)) return tarArchive.extract(job, sourcePath, targetPath);
  if (isGzipTar(sourcePath)) {
    return tarArchive.extract(job, sourcePath, targetPath, tarArchive.createPipedSource(createGunzip));
  }
  if (isForeignCompressedTar(sourcePath)) {
    return tarArchive.extract(
      job,
      sourcePath,
      targetPath,
      file => createSevenZipTarSource(file, child => { job.child = child; })
    );
  }
  // unrar-js runs in WebAssembly with a stubbed symlink syscall and writes link
  // entries as regular files, so the tree verification in ArchiveService is the
  // safety net for RAR.
  if (path.extname(sourcePath).toLowerCase() === '.rar') return extractRar(job, sourcePath, targetPath);
  await assertSevenZipSymlinksSafe(job, sourcePath, targetPath);
  await run7Zip(['x', '-y', `-o${targetPath}`, '--', sourcePath], child => {
    job.child = child;
  });
}

module.exports = { capabilities, extract, isArchivePath, listEntries };
