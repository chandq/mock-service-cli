const {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  promises: fsPromises,
  renameSync,
  rmSync
} = require('fs');
const path = require('path');
const archiver = require('archiver');
const archiveProvider = require('./archiveProvider');
const { createArchiveError, isInside, isSafeArchiveEntry, verifyExtractedTree } = require('./archiveShared');
const { validateEntryName } = require('./utils');

const ARCHIVE_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024 * 1024,
  maxEntries: 1000000,
  maxCompressionRatio: 2000
});

function formatLimit(bytes) {
  return `${Math.round(bytes / (1024 * 1024 * 1024))}GB`;
}

// lstat-based existence check: a dangling symlink still occupies the destination name.
function pathExists(targetPath) {
  try {
    lstatSync(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

// Validates an archive input path. Callers resolve the path first so this helper
// stays shared between the explorer service and the one-shot CLI command.
function assertArchiveFile(fullPath) {
  if (!existsSync(fullPath)) throw createArchiveError('Path not found', 404);
  const stats = lstatSync(fullPath);
  if (!stats.isFile()) throw createArchiveError('Archive path must be a file');
  if (!archiveProvider.isArchivePath(fullPath)) throw createArchiveError('Unsupported archive format');
  if (stats.size > ARCHIVE_LIMITS.maxBytes)
    throw createArchiveError(`Archive exceeds ${formatLimit(ARCHIVE_LIMITS.maxBytes)} limit`, 413);
}

function assertEntriesSafe(entries, fullPath) {
  if (!entries.length) throw createArchiveError('Archive contains no entries', 422);
  if (entries.length > ARCHIVE_LIMITS.maxEntries)
    throw createArchiveError(`Archive contains more than ${ARCHIVE_LIMITS.maxEntries} entries`, 413);
  if (entries.some(entry => entry.encrypted)) throw createArchiveError('Encrypted archives are not supported', 422);
  // Listing is a read-only header inspection: allow symlink/special entries to be
  // displayed (e.g. the official Node.js tarball ships bin/npm as symlinks), but
  // keep rejecting path traversal. Extraction validates each link target instead.
  if (entries.some(entry => !isSafeArchiveEntry(entry.path))) {
    throw createArchiveError('Archive contains an unsafe entry path', 422);
  }

  const totalSize = entries.reduce((total, entry) => total + (Number(entry.size) || 0), 0);
  const packedSize = Math.max(lstatSync(fullPath).size, 1);
  if (totalSize > ARCHIVE_LIMITS.maxBytes)
    throw createArchiveError(`Archive expands beyond ${formatLimit(ARCHIVE_LIMITS.maxBytes)} limit`, 413);
  if (totalSize / packedSize > ARCHIVE_LIMITS.maxCompressionRatio)
    throw createArchiveError('Archive compression ratio exceeds limit', 413);
}

async function listArchiveFile(fullPath) {
  assertArchiveFile(fullPath);
  const entries = await archiveProvider.listEntries(fullPath);
  assertEntriesSafe(entries, fullPath);
  const totalSize = entries.reduce((total, entry) => total + (Number(entry.size) || 0), 0);
  const reportedPackedSize = entries.reduce((total, entry) => total + (Number(entry.packedSize) || 0), 0);
  return {
    name: path.basename(fullPath),
    entries,
    totalEntries: entries.length,
    totalSize,
    // TAR streams do not expose per-entry packed sizes, so fall back to the
    // archive file size instead of showing "0 B" in the preview.
    totalPackedSize: reportedPackedSize || lstatSync(fullPath).size
  };
}

// archiver.directory() lets glob follow links, which can read outside the
// source tree. Walk explicitly and let archiver store each link as a link.
async function appendSource(archive, sourcePath, entryName, isRoot = false) {
  const stats = await fsPromises.lstat(sourcePath);
  if (stats.isSymbolicLink()) {
    const target = await fsPromises.readlink(sourcePath);
    archive.symlink(entryName, target.split(path.sep).join('/'));
    return;
  }
  if (!stats.isDirectory()) {
    archive.file(sourcePath, { name: entryName, stats });
    return;
  }
  if (!isRoot) archive.file(sourcePath, { name: entryName, stats });
  const children = await fsPromises.readdir(sourcePath, { withFileTypes: true });
  await Promise.all(
    children.map(child => appendSource(archive, path.join(sourcePath, child.name), `${entryName}/${child.name}`))
  );
}

async function createArchiveFile({ sourcePaths, destinationPath, name, format, job }) {
  const normalizedFormat = format === 'tar.gz' ? 'tar.gz' : format;
  if (!archiveProvider.capabilities.createFormats.includes(normalizedFormat)) {
    const formats = archiveProvider.capabilities.createFormats.join(' and ');
    throw createArchiveError(`Supported creation formats are ${formats}`);
  }
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    throw createArchiveError('Sources must be a non-empty array');
  }
  if (!existsSync(destinationPath) || !lstatSync(destinationPath).isDirectory()) {
    throw createArchiveError('Archive destination must be an existing directory', 404);
  }

  sourcePaths.forEach(source => {
    // lstat-based check so dangling symlinks can be archived as links.
    if (!pathExists(source)) throw createArchiveError('Source path not found', 404);
  });
  // Every source is stored under its basename, so identical names would
  // silently collide inside the archive.
  const entryNames = sourcePaths.map(source => path.basename(source));
  const entryKeys = entryNames.map(entryName => (process.platform === 'win32' ? entryName.toLowerCase() : entryName));
  if (new Set(entryKeys).size !== entryKeys.length) {
    throw createArchiveError('Sources must have unique names');
  }

  const archiveName = String(name || '').trim();
  if (!archiveName) throw createArchiveError('Archive name is required');
  const requiredExtension = normalizedFormat === 'zip' ? '.zip' : '.tar.gz';
  const safeName = archiveName.endsWith(requiredExtension) ? archiveName : `${archiveName}${requiredExtension}`;
  const nameError = validateEntryName(safeName);
  if (nameError) throw createArchiveError(`Invalid archive name: ${nameError}`);
  const outputPath = path.join(destinationPath, safeName);
  if (pathExists(outputPath)) throw createArchiveError('Archive path already exists', 409);
  // Writing the archive inside a directory that is being archived would make
  // archiver read its own growing output.
  sourcePaths.forEach(source => {
    if (lstatSync(source).isDirectory() && isInside(source, outputPath)) {
      throw createArchiveError('Archive output must be outside the source directory');
    }
  });

  job.progress.totalEntries = sourcePaths.length;
  await new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath, { flags: 'wx' });
    const archive =
      normalizedFormat === 'zip'
        ? archiver('zip', { zlib: { level: 9 } })
        : archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
    job.archive = archive;
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('progress', progress => {
      job.progress.processedEntries = progress.entries.processed;
      job.progress.totalEntries = progress.entries.total;
    });
    archive.pipe(output);
    Promise.all(sourcePaths.map(source => appendSource(archive, source, path.basename(source), true)))
      .then(() => archive.finalize())
      .catch(error => {
        archive.abort();
        reject(error);
      });
  }).catch(error => {
    rmSync(outputPath, { force: true, maxRetries: 20, retryDelay: 100 });
    throw error;
  });

  if (job.cancelled) {
    rmSync(outputPath, { force: true, maxRetries: 20, retryDelay: 100 });
    throw createArchiveError('Archive job cancelled', 499);
  }
  return { path: outputPath, name: path.basename(outputPath) };
}

async function extractArchiveFile({ sourcePath, destinationPath, job }) {
  if (!existsSync(destinationPath) || !lstatSync(destinationPath).isDirectory()) {
    throw createArchiveError('Extraction destination must be an existing directory', 404);
  }
  const listing = await listArchiveFile(sourcePath);
  job.progress.totalEntries = listing.totalEntries;
  const tempRoot = await fsPromises.mkdtemp(path.join(destinationPath, '.mock-service-cli-archive-'));
  const tempOutput = path.join(tempRoot, 'output');
  mkdirSync(tempOutput);

  try {
    await archiveProvider.extract(job, sourcePath, tempOutput);
    if (job.cancelled) throw createArchiveError('Archive job cancelled', 499);
    // Allows in-tree symlinks (Node.js tarballs rely on them) while rejecting
    // links or entries that resolve outside the temporary extraction folder.
    verifyExtractedTree(tempOutput);
    const outputEntries = await fsPromises.readdir(tempOutput);
    if (!outputEntries.length) throw createArchiveError('Archive produced no files', 422);
    outputEntries.forEach(name => {
      if (pathExists(path.join(destinationPath, name)))
        throw createArchiveError(`Destination already contains ${name}`, 409);
    });
    for (const name of outputEntries) {
      renameSync(path.join(tempOutput, name), path.join(destinationPath, name));
    }
    job.progress.processedEntries = job.progress.totalEntries;
    return { destinationPath, entries: outputEntries };
  } finally {
    // Windows may still hold brief handles from aborted writes; retry instead
    // of leaving temporary extraction directories behind.
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

module.exports = {
  ARCHIVE_LIMITS,
  assertArchiveFile,
  createArchiveFile,
  extractArchiveFile,
  listArchiveFile
};
