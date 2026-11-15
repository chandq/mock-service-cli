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

const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10000;
const MAX_COMPRESSION_RATIO = 100;

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
  if (stats.size > MAX_ARCHIVE_SIZE) throw createArchiveError('Archive exceeds 2GB limit', 413);
}

function assertEntriesSafe(entries, fullPath) {
  if (!entries.length) throw createArchiveError('Archive contains no entries', 422);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw createArchiveError('Archive contains too many entries', 413);
  if (entries.some(entry => entry.encrypted)) throw createArchiveError('Encrypted archives are not supported', 422);
  // Listing is a read-only header inspection: allow symlink/special entries to be
  // displayed (e.g. the official Node.js tarball ships bin/npm as symlinks), but
  // keep rejecting path traversal. Extraction validates each link target instead.
  if (entries.some(entry => !isSafeArchiveEntry(entry.path))) {
    throw createArchiveError('Archive contains an unsafe entry path', 422);
  }

  const totalSize = entries.reduce((total, entry) => total + (Number(entry.size) || 0), 0);
  const packedSize = Math.max(lstatSync(fullPath).size, 1);
  if (totalSize > MAX_ARCHIVE_SIZE) throw createArchiveError('Archive expands beyond 2GB limit', 413);
  if (totalSize / packedSize > MAX_COMPRESSION_RATIO)
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

async function assertSourceTreeSafe(source) {
  const stats = await fsPromises.lstat(source);
  if (stats.isSymbolicLink()) throw createArchiveError('Symbolic links cannot be archived');
  if (!stats.isDirectory()) return;
  const entries = await fsPromises.readdir(source, { withFileTypes: true });
  await Promise.all(entries.map(entry => assertSourceTreeSafe(path.join(source, entry.name))));
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
    if (!existsSync(source)) throw createArchiveError('Source path not found', 404);
    if (lstatSync(source).isSymbolicLink()) throw createArchiveError('Symbolic links cannot be archived');
  });
  await Promise.all(sourcePaths.map(source => assertSourceTreeSafe(source)));

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
    sourcePaths.forEach(source => {
      const stats = lstatSync(source);
      if (stats.isDirectory()) archive.directory(source, path.basename(source));
      else archive.file(source, { name: path.basename(source) });
    });
    archive.finalize();
  }).catch(error => {
    rmSync(outputPath, { force: true, maxRetries: 10, retryDelay: 50 });
    throw error;
  });

  if (job.cancelled) {
    rmSync(outputPath, { force: true, maxRetries: 10, retryDelay: 50 });
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
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

module.exports = {
  assertArchiveFile,
  createArchiveFile,
  extractArchiveFile,
  listArchiveFile
};
