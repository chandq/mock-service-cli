const { existsSync, lstatSync, realpathSync } = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiveProvider = require('./archiveProvider');
const {
  assertArchiveFile,
  createArchiveFile,
  extractArchiveFile,
  listArchiveFile
} = require('./archiveTask');
const { createArchiveError, isInside } = require('./archiveShared');

class ArchiveService {
  constructor({ rootPath, resolvePath }) {
    this.rootPath = rootPath;
    this.resolvePath = resolvePath;
    this.jobs = new Map();
  }

  resolveExistingFile(inputPath) {
    const fullPath = this.resolvePath(inputPath);
    assertArchiveFile(fullPath);
    return fullPath;
  }

  async listArchive(inputPath) {
    const fullPath = this.resolveExistingFile(inputPath);
    const listing = await listArchiveFile(fullPath);
    return { path: inputPath, ...listing };
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
    if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
      throw createArchiveError('Sources must be a non-empty array');
    }
    const sourcePaths = payload.sources.map(source => this.resolvePath(source));
    sourcePaths.forEach(source => {
      if (!existsSync(source)) throw createArchiveError('Source path not found', 404);
      if (lstatSync(source).isSymbolicLink()) throw createArchiveError('Symbolic links cannot be archived');
      const realPath = realpathSync(source);
      if (!isInside(this.rootPath, realPath)) throw createArchiveError('Access denied', 403);
    });

    const destinationPath = this.resolvePath(payload.destinationPath || path.posix.dirname(payload.sources[0]));
    return createArchiveFile({
      sourcePaths,
      destinationPath,
      name: payload.name,
      format: payload.format,
      job
    });
  }

  async extractArchive(job, payload) {
    const sourcePath = this.resolveExistingFile(payload.path);
    const destinationPath = this.resolvePath(payload.destinationPath || '/');
    return extractArchiveFile({ sourcePath, destinationPath, job });
  }
}

module.exports = { ArchiveService, isArchivePath: archiveProvider.isArchivePath };
