const {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  promises: fsPromises,
  realpathSync,
  renameSync,
  rmSync
} = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const archiveProvider = require('./archiveProvider');
const { createArchiveError, isInside, isSafeArchiveEntry } = require('./archiveShared');

const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10000;
const MAX_COMPRESSION_RATIO = 100;
class ArchiveService {
  constructor({ rootPath, resolvePath, getChildPath }) {
    this.rootPath = rootPath;
    this.resolvePath = resolvePath;
    this.getChildPath = getChildPath;
    this.jobs = new Map();
  }

  resolveExistingFile(inputPath) {
    const fullPath = this.resolvePath(inputPath);
    if (!existsSync(fullPath)) throw createArchiveError('Path not found', 404);
    const stats = lstatSync(fullPath);
    if (!stats.isFile()) throw createArchiveError('Archive path must be a file');
    if (!archiveProvider.isArchivePath(fullPath)) throw createArchiveError('Unsupported archive format');
    if (stats.size > MAX_ARCHIVE_SIZE) throw createArchiveError('Archive exceeds 2GB limit', 413);
    return fullPath;
  }

  async listArchive(inputPath) {
    const fullPath = this.resolveExistingFile(inputPath);
    const entries = await archiveProvider.listEntries(fullPath);
    this.assertEntriesSafe(entries, fullPath);
    return {
      path: inputPath,
      name: path.basename(fullPath),
      entries,
      totalEntries: entries.length,
      totalSize: entries.reduce((total, entry) => total + entry.size, 0),
      totalPackedSize: entries.reduce((total, entry) => total + entry.packedSize, 0)
    };
  }

  assertEntriesSafe(entries, fullPath) {
    if (!entries.length) throw createArchiveError('Archive contains no entries', 422);
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw createArchiveError('Archive contains too many entries', 413);
    if (entries.some(entry => entry.encrypted)) throw createArchiveError('Encrypted archives are not supported', 422);
    if (entries.some(entry => entry.isSymbolicLink || !isSafeArchiveEntry(entry.path))) {
      throw createArchiveError('Archive contains an unsafe entry path', 422);
    }

    const totalSize = entries.reduce((total, entry) => total + entry.size, 0);
    const packedSize = Math.max(lstatSync(fullPath).size, 1);
    if (totalSize > MAX_ARCHIVE_SIZE) throw createArchiveError('Archive expands beyond 2GB limit', 413);
    if (totalSize / packedSize > MAX_COMPRESSION_RATIO)
      throw createArchiveError('Archive compression ratio exceeds limit', 413);
  }

  startJob(type, payload) {
    const id = crypto.randomUUID();
    const job = {
      id,
      type,
      status: 'queued',
      progress: { processedEntries: 0, totalEntries: 0 },
      createdAt: new Date().toISOString(),
      result: null,
      error: null,
      cancelled: false,
      child: null,
      archive: null
    };
    this.jobs.set(id, job);
    setImmediate(async () => {
      if (job.cancelled) return;
      job.status = 'running';
      try {
        job.result =
          type === 'create' ? await this.createArchive(job, payload) : await this.extractArchive(job, payload);
        job.status = job.cancelled ? 'cancelled' : 'completed';
      } catch (error) {
        job.status = job.cancelled ? 'cancelled' : 'failed';
        job.error = error.message;
      } finally {
        job.child = null;
        job.archive = null;
        job.finishedAt = new Date().toISOString();
      }
    });
    return job;
  }

  getJob(id) {
    return this.jobs.get(id);
  }

  getCapabilities() {
    return archiveProvider.capabilities;
  }

  cancelJob(id) {
    const job = this.getJob(id);
    if (!job) throw createArchiveError('Archive job not found', 404);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    job.cancelled = true;
    job.status = 'cancelled';
    if (job.child) job.child.kill('SIGTERM');
    if (job.archive) job.archive.abort();
    return job;
  }

  async createArchive(job, payload) {
    const format = payload.format === 'tar.gz' ? 'tar.gz' : payload.format;
    if (!archiveProvider.capabilities.createFormats.includes(format)) {
      const formats = archiveProvider.capabilities.createFormats.join(' and ');
      throw createArchiveError(`Supported creation formats are ${formats}`);
    }
    if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
      throw createArchiveError('Sources must be a non-empty array');
    }

    const sourcePaths = payload.sources.map(source => this.resolvePath(source));
    sourcePaths.forEach(source => {
      if (!existsSync(source)) throw createArchiveError('Source path not found', 404);
      const stats = lstatSync(source);
      if (stats.isSymbolicLink()) throw createArchiveError('Symbolic links cannot be archived');
      const realPath = realpathSync(source);
      if (!isInside(this.rootPath, realPath)) throw createArchiveError('Access denied', 403);
    });
    await Promise.all(sourcePaths.map(source => this.assertSourceTreeSafe(source)));

    const destinationPath = payload.destinationPath || path.posix.dirname(payload.sources[0]);
    const archiveName = String(payload.name || '').trim();
    const requiredExtension = format === 'zip' ? '.zip' : '.tar.gz';
    const safeName = archiveName.endsWith(requiredExtension) ? archiveName : `${archiveName}${requiredExtension}`;
    const outputPath = this.getChildPath(destinationPath, safeName);
    if (existsSync(outputPath)) throw createArchiveError('Archive path already exists', 409);

    job.progress.totalEntries = sourcePaths.length;
    await new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath, { flags: 'wx' });
      const archive =
        format === 'zip'
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
      rmSync(outputPath, { force: true });
      throw error;
    });

    if (job.cancelled) {
      rmSync(outputPath, { force: true });
      throw createArchiveError('Archive job cancelled', 499);
    }
    return { path: outputPath, name: path.basename(outputPath) };
  }

  async extractArchive(job, payload) {
    const sourcePath = this.resolveExistingFile(payload.path);
    const destinationPath = this.resolvePath(payload.destinationPath || '/');
    if (!existsSync(destinationPath) || !lstatSync(destinationPath).isDirectory()) {
      throw createArchiveError('Extraction destination must be an existing directory', 404);
    }
    const listing = await this.listArchive(payload.path);
    job.progress.totalEntries = listing.totalEntries;
    const tempRoot = await fsPromises.mkdtemp(path.join(destinationPath, '.mock-service-cli-archive-'));
    const tempOutput = path.join(tempRoot, 'output');
    mkdirSync(tempOutput);

    try {
      await archiveProvider.extract(job, sourcePath, tempOutput);
      if (job.cancelled) throw createArchiveError('Archive job cancelled', 499);
      await this.assertExtractedTreeSafe(tempOutput);
      const outputEntries = await fsPromises.readdir(tempOutput);
      if (!outputEntries.length) throw createArchiveError('Archive produced no files', 422);
      outputEntries.forEach(name => {
        if (existsSync(path.join(destinationPath, name)))
          throw createArchiveError(`Destination already contains ${name}`, 409);
      });
      for (const name of outputEntries) {
        renameSync(path.join(tempOutput, name), path.join(destinationPath, name));
      }
      job.progress.processedEntries = job.progress.totalEntries;
      return { destinationPath, entries: outputEntries };
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  async assertExtractedTreeSafe(root) {
    const rootRealPath = realpathSync(root);
    const walk = async current => {
      const entries = await fsPromises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const child = path.join(current, entry.name);
        const stats = await fsPromises.lstat(child);
        if (stats.isSymbolicLink()) throw createArchiveError('Archive contains symbolic links', 422);
        const realPath = realpathSync(child);
        if (!isInside(rootRealPath, realPath)) {
          throw createArchiveError('Archive extracted outside its destination', 422);
        }
        if (stats.isDirectory()) await walk(child);
      }
    };
    await walk(root);
  }

  async assertSourceTreeSafe(source) {
    const stats = await fsPromises.lstat(source);
    if (stats.isSymbolicLink()) throw createArchiveError('Symbolic links cannot be archived');
    if (!stats.isDirectory()) return;
    const entries = await fsPromises.readdir(source, { withFileTypes: true });
    await Promise.all(entries.map(entry => this.assertSourceTreeSafe(path.join(source, entry.name))));
  }
}

module.exports = { ArchiveService, isArchivePath: archiveProvider.isArchivePath };
