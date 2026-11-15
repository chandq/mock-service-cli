const test = require('tap').test;
const { expectRejection } = require('./archiveTestHelpers');
const {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require('fs');
const os = require('os');
const path = require('path');
const { createArchiveFile, extractArchiveFile, listArchiveFile } = require('../src/lib/archiveTask');

function createJob() {
  return { progress: { processedEntries: 0, totalEntries: 0 }, cancelled: false, child: null, archive: null };
}

function removeTempDir(targetPath) {
  rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test('archive task core round-trips zip and tar.gz archives with Chinese names', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-task-'));
  const source = path.join(root, '来源');
  mkdirSync(path.join(source, '中文目录'), { recursive: true });
  writeFileSync(path.join(source, 'hello.txt'), 'hello');
  writeFileSync(path.join(source, '中文目录', '文件.txt'), '内容');
  const output = path.join(root, 'out');
  mkdirSync(output);

  try {
    for (const format of ['zip', 'tar.gz']) {
      const created = await createArchiveFile({
        sourcePaths: [source],
        destinationPath: output,
        name: `包-${format === 'zip' ? 'zip' : 'targz'}`,
        format,
        job: createJob()
      });
      t.ok(existsSync(created.path), `creates ${format} archives`);

      const listed = await listArchiveFile(created.path);
      t.equal(listed.totalEntries, 3, `lists ${format} entries`);
      t.ok(listed.totalPackedSize > 0, `reports ${format} packed size`);

      const extracted = path.join(root, `extract-${format === 'zip' ? 'zip' : 'targz'}`);
      mkdirSync(extracted);
      await extractArchiveFile({ sourcePath: created.path, destinationPath: extracted, job: createJob() });
      t.equal(
        readFileSync(path.join(extracted, '来源', '中文目录', '文件.txt'), 'utf8'),
        '内容',
        `extracts ${format} entries under the source directory`
      );
    }
  } finally {
    removeTempDir(root);
  }
});

test('archive task core rejects unsafe names and duplicate source basenames', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-task-guard-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  mkdirSync(first);
  mkdirSync(second);
  writeFileSync(path.join(first, 'data.txt'), 'first');
  writeFileSync(path.join(second, 'data.txt'), 'second');
  const output = path.join(root, 'out');
  mkdirSync(output);

  try {
    await expectRejection(
      t,
      createArchiveFile({
        sourcePaths: [path.join(first, 'data.txt'), path.join(second, 'data.txt')],
        destinationPath: output,
        name: 'bundle',
        format: 'zip',
        job: createJob()
      }),
      /Sources must have unique names/,
      'rejects sources that would collide inside the archive'
    );

    await expectRejection(
      t,
      createArchiveFile({
        sourcePaths: [path.join(first, 'data.txt')],
        destinationPath: output,
        name: '../escape',
        format: 'zip',
        job: createJob()
      }),
      /Invalid archive name/,
      'rejects archive names containing path separators'
    );
    t.notOk(existsSync(path.join(root, 'escape.zip')), 'never writes outside the output directory');

    await expectRejection(
      t,
      createArchiveFile({
        sourcePaths: [path.join(first, 'data.txt')],
        destinationPath: output,
        name: '',
        format: 'zip',
        job: createJob()
      }),
      /Archive name is required/,
      'rejects empty archive names'
    );
  } finally {
    removeTempDir(root);
  }
});

test('archive task core refuses to write the archive inside its source directory', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-task-self-'));
  const source = path.join(root, 'data');
  mkdirSync(path.join(source, 'nested'), { recursive: true });
  writeFileSync(path.join(source, 'file.txt'), 'data');

  try {
    await expectRejection(
      t,
      createArchiveFile({
        sourcePaths: [source],
        destinationPath: path.join(source, 'nested'),
        name: 'bundle',
        format: 'zip',
        job: createJob()
      }),
      /outside the source directory/,
      'refuses to archive a directory into itself'
    );
    t.notOk(existsSync(path.join(source, 'nested', 'bundle.zip')), 'does not create a self-including archive');
  } finally {
    removeTempDir(root);
  }
});

test('archive task core refuses to overwrite an existing archive', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-task-conflict-'));
  const source = path.join(root, 'data.txt');
  writeFileSync(source, 'data');
  const output = path.join(root, 'out');
  mkdirSync(output);

  try {
    const created = await createArchiveFile({
      sourcePaths: [source],
      destinationPath: output,
      name: 'bundle',
      format: 'zip',
      job: createJob()
    });
    await expectRejection(
      t,
      createArchiveFile({
        sourcePaths: [source],
        destinationPath: output,
        name: 'bundle',
        format: 'zip',
        job: createJob()
      }),
      /Archive path already exists/,
      'does not overwrite the archive'
    );
    t.ok(existsSync(created.path), 'keeps the original archive');
  } finally {
    removeTempDir(root);
  }
});

test('archive task core preserves in-tree symbolic links', async t => {
  if (process.platform === 'win32') {
    t.skip('symbolic link fixture requires the Windows symlink privilege');
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-task-link-'));
  const source = path.join(root, 'source');
  mkdirSync(source);
  writeFileSync(path.join(source, 'target.txt'), 'target content');
  symlinkSync('target.txt', path.join(source, 'link.txt'));
  const output = path.join(root, 'out');
  mkdirSync(output);

  try {
    for (const format of ['zip', 'tar.gz']) {
      const created = await createArchiveFile({
        sourcePaths: [source],
        destinationPath: output,
        name: `链接-${format === 'zip' ? 'zip' : 'targz'}`,
        format,
        job: createJob()
      });
      const listed = await listArchiveFile(created.path);
      const linkEntry = listed.entries.find(entry => entry.path === 'source/link.txt');
      t.ok(linkEntry && linkEntry.isSymbolicLink, `${format} stores symbolic links as links`);

      const extractDir = path.join(root, `extract-link-${format === 'zip' ? 'zip' : 'targz'}`);
      mkdirSync(extractDir);
      await extractArchiveFile({ sourcePath: created.path, destinationPath: extractDir, job: createJob() });
      const linkPath = path.join(extractDir, 'source', 'link.txt');
      t.ok(lstatSync(linkPath).isSymbolicLink(), `${format} restores the symbolic link`);
      t.equal(readlinkSync(linkPath), 'target.txt', `${format} keeps the link target`);
      t.equal(readFileSync(linkPath, 'utf8'), 'target content', `${format} link resolves to the archived file`);
    }
  } finally {
    removeTempDir(root);
  }
});
