const { chmodSync, promises: fsPromises, rmSync } = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { path7za } = require('7zip-bin');
const { createExtractorFromFile } = require('node-unrar-js');
const { createArchiveError, hasArchiveExtension } = require('../archiveShared');

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

function isCompressedTar(filePath) {
  return /\.(tar\.gz|tgz|tar\.bz2|tbz|tbz2|tar\.xz|txz)$/i.test(filePath);
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

  return blocks.map(values => ({
    path: values.Path.replace(/\\/g, '/'),
    isDirectory: values.Folder === '+' || String(values.Attributes || '').startsWith('D'),
    size: Number(values.Size || 0),
    packedSize: Number(values['Packed Size'] || 0),
    encrypted: values.Encrypted === '+',
    modified: values.Modified || null,
    attributes: values.Attributes || ''
  }));
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

async function list7Zip(fullPath) {
  const output = await run7Zip(['l', '-slt', '--', fullPath]);
  const entries = parse7ZipList(output);
  if (!isCompressedTar(fullPath)) return entries;

  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mock-service-cli-archive-list-'));
  try {
    await run7Zip(['e', '-y', `-o${tempRoot}`, '--', fullPath]);
    const extracted = await fsPromises.readdir(tempRoot);
    const tarName = extracted.find(name => /\.tar$/i.test(name));
    if (!tarName) return entries;
    return await list7Zip(path.join(tempRoot, tarName));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function listRar(fullPath) {
  const extractor = await createExtractorFromFile({ filepath: fullPath });
  const list = extractor.getFileList();
  if (list.arcHeader.flags && list.arcHeader.flags.headerEncrypted) {
    throw createArchiveError('Encrypted archives are not supported', 422);
  }
  return [...list.fileHeaders].map(header => ({
    path: header.name.replace(/\\/g, '/'),
    isDirectory: Boolean(header.flags && header.flags.directory),
    size: Number(header.unpSize || 0),
    packedSize: Number(header.packSize || 0),
    encrypted: Boolean(header.flags && header.flags.encrypted),
    modified: header.time || null,
    attributes: ''
  }));
}

async function listEntries(fullPath) {
  return path.extname(fullPath).toLowerCase() === '.rar' ? listRar(fullPath) : list7Zip(fullPath);
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

async function extract(job, sourcePath, targetPath) {
  if (path.extname(sourcePath).toLowerCase() === '.rar') return extractRar(job, sourcePath, targetPath);
  await run7Zip(['x', '-y', `-o${targetPath}`, '--', sourcePath], child => {
    job.child = child;
  });
}

module.exports = { capabilities, extract, isArchivePath, listEntries };
