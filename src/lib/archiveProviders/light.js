const { createReadStream, createWriteStream, mkdirSync } = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createGunzip } = require('zlib');
const tar = require('tar-stream');
const yauzl = require('yauzl');
const { createArchiveError, hasArchiveExtension, isSafeArchiveEntry } = require('../archiveShared');

const extensions = ['.tar.gz', '.tgz', '.zip', '.tar'];
const capabilities = {
  edition: 'light',
  createFormats: ['zip', 'tar.gz'],
  readExtensions: extensions.map(extension => extension.slice(1))
};

function isArchivePath(filePath) {
  return hasArchiveExtension(filePath, extensions);
}

function isZipPath(filePath) {
  return String(filePath).toLowerCase().endsWith('.zip');
}

function isCompressedTarPath(filePath) {
  return /\.(tar\.gz|tgz)$/i.test(filePath);
}

function isTarMetadataEntry(header) {
  return ['pax-global-header', 'pax-header', 'gnu-long-path', 'gnu-long-link'].includes(header.type);
}

function isSafeTarEntry(header) {
  return ['file', 'directory'].includes(header.type) && isSafeArchiveEntry(header.name);
}

function isZipDirectory(entry) {
  return /\/$/.test(entry.fileName);
}

function isZipSymbolicLink(entry) {
  const mode = Math.floor(Number(entry.externalFileAttributes || 0) / 0x10000) % 0x10000;
  return Math.floor(mode / 0o10000) % 0o20 === 0o12;
}

function isZipEncrypted(entry) {
  return Number(entry.generalPurposeBitFlag || 0) % 2 === 1;
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { autoClose: true, lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error) reject(createArchiveError(`Unable to read ZIP archive: ${error.message}`, 422));
      else resolve(zipFile);
    });
  });
}

async function listZip(filePath) {
  const zipFile = await openZip(filePath);
  return new Promise((resolve, reject) => {
    const entries = [];
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      callback(value);
    };

    zipFile.on('entry', entry => {
      entries.push({
        path: entry.fileName.replace(/\\/g, '/'),
        isDirectory: isZipDirectory(entry),
        isSymbolicLink: isZipSymbolicLink(entry),
        size: Number(entry.uncompressedSize || 0),
        packedSize: Number(entry.compressedSize || 0),
        encrypted: isZipEncrypted(entry),
        modified: entry.getLastModDate().toISOString(),
        attributes: ''
      });
      zipFile.readEntry();
    });
    zipFile.once('end', () => finish(resolve, entries));
    zipFile.once('error', error => finish(reject, createArchiveError(`Unable to read ZIP archive: ${error.message}`, 422)));
    zipFile.readEntry();
  });
}

async function listTar(filePath) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const extractor = tar.extract();
    const input = createReadStream(filePath);
    const streams = [input, extractor];
    let source = input;
    let settled = false;
    if (isCompressedTarPath(filePath)) {
      const gunzip = createGunzip();
      streams.push(gunzip);
      source = input.pipe(gunzip);
    }
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = error => {
      streams.forEach(stream => stream.destroy());
      finish(reject, createArchiveError(`Unable to read TAR archive: ${error.message}`, 422));
    };

    streams.forEach(stream => stream.once('error', fail));
    extractor.on('entry', (header, entryStream, next) => {
      if (!isTarMetadataEntry(header)) {
        entries.push({
          path: String(header.name || '').replace(/\\/g, '/'),
          isDirectory: header.type === 'directory',
          isSymbolicLink: !isSafeTarEntry(header),
          size: Number(header.size || 0),
          packedSize: 0,
          encrypted: false,
          modified: header.mtime ? new Date(header.mtime).toISOString() : null,
          attributes: header.type || ''
        });
      }
      entryStream.once('error', fail);
      entryStream.once('end', next);
      entryStream.resume();
    });
    extractor.once('finish', () => finish(resolve, entries));
    source.pipe(extractor);
  });
}

async function listEntries(filePath) {
  return isZipPath(filePath) ? listZip(filePath) : listTar(filePath);
}

function assertZipEntrySafe(entry) {
  if (!isSafeArchiveEntry(entry.fileName) || isZipSymbolicLink(entry)) {
    throw createArchiveError('Archive contains an unsafe entry path', 422);
  }
  if (isZipEncrypted(entry)) {
    throw createArchiveError('Encrypted archives are not supported', 422);
  }
}

async function extractZip(job, sourcePath, targetPath) {
  const zipFile = await openZip(sourcePath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      callback(value);
    };
    const next = () => {
      if (!settled) zipFile.readEntry();
    };

    zipFile.on('entry', entry => {
      try {
        assertZipEntrySafe(entry);
        const outputPath = path.join(targetPath, entry.fileName);
        if (isZipDirectory(entry)) {
          mkdirSync(outputPath, { recursive: true });
          job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
          next();
          return;
        }
        mkdirSync(path.dirname(outputPath), { recursive: true });
        zipFile.openReadStream(entry, async (error, input) => {
          if (error) return finish(reject, createArchiveError(`Unable to extract ZIP archive: ${error.message}`, 422));
          try {
            await pipeline(input, createWriteStream(outputPath, { flags: 'wx' }));
            job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
            return next();
          } catch (streamError) {
            finish(reject, createArchiveError(`Unable to extract ZIP archive: ${streamError.message}`, 422));
          }
        });
      } catch (error) {
        finish(reject, error);
      }
    });
    zipFile.once('end', () => finish(resolve));
    zipFile.once('error', error => finish(reject, createArchiveError(`Unable to extract ZIP archive: ${error.message}`, 422)));
    zipFile.readEntry();
  });
}

async function extractTar(job, sourcePath, targetPath) {
  return new Promise((resolve, reject) => {
    const extractor = tar.extract();
    const input = createReadStream(sourcePath);
    const streams = [input, extractor];
    let source = input;
    let settled = false;
    if (isCompressedTarPath(sourcePath)) {
      const gunzip = createGunzip();
      streams.push(gunzip);
      source = input.pipe(gunzip);
    }
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = error => {
      streams.forEach(stream => stream.destroy());
      const archiveError = error.statusCode ? error : createArchiveError(`Unable to extract TAR archive: ${error.message}`, 422);
      finish(reject, archiveError);
    };

    streams.forEach(stream => stream.once('error', fail));
    extractor.on('entry', (header, entryStream, next) => {
      if (isTarMetadataEntry(header)) {
        entryStream.once('error', fail);
        entryStream.once('end', next);
        entryStream.resume();
        return;
      }
      if (!isSafeTarEntry(header)) {
        fail(createArchiveError('Archive contains an unsafe entry path', 422));
        return;
      }
      const outputPath = path.join(targetPath, header.name);
      if (header.type === 'directory') {
        mkdirSync(outputPath, { recursive: true });
        entryStream.once('error', fail);
        entryStream.once('end', () => {
          job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
          next();
        });
        entryStream.resume();
        return;
      }
      mkdirSync(path.dirname(outputPath), { recursive: true });
      pipeline(entryStream, createWriteStream(outputPath, { flags: 'wx' }))
        .then(() => {
          job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
          next();
        })
        .catch(fail);
    });
    extractor.once('finish', () => finish(resolve));
    source.pipe(extractor);
  });
}

async function extract(job, sourcePath, targetPath) {
  return isZipPath(sourcePath) ? extractZip(job, sourcePath, targetPath) : extractTar(job, sourcePath, targetPath);
}

module.exports = { capabilities, extract, isArchivePath, listEntries };
