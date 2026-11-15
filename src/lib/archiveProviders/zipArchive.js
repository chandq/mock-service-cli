const { createWriteStream, mkdirSync, realpathSync } = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const {
  assertNoEscapingAncestor,
  createArchiveError,
  createSafeSymlink,
  decodeArchiveNameBytes,
  isSafeArchiveEntry,
  resolveSafeLinkTarget,
  verifyExtractedTree
} = require('../archiveShared');

const UTF8_NAMES_FLAG = 0x800;
const INFOZIP_UNICODE_PATH_EXTRA = 0x7075;
const MAX_SYMLINK_TARGET_BYTES = 4096;

// Directory detection without trusting a single convention: a trailing slash (or
// backslash from old Windows writers) in the raw name, plus the DOS directory
// attribute or the Unix S_IFDIR mode for writers that omit the trailing slash.
function isZipDirectoryEntry(entry) {
  const rawName = entry.fileName;
  if (Buffer.isBuffer(rawName)) {
    const last = rawName[rawName.length - 1];
    if (last === 0x2f || last === 0x5c) return true;
  } else if (typeof rawName === 'string' && /[\\/]$/.test(rawName)) {
    return true;
  }
  const hostSystem = Number(entry.versionMadeBy || 0) >> 8;
  const externalAttributes = Number(entry.externalFileAttributes || 0);
  if (hostSystem === 0 && externalAttributes & 0x10) return true;
  const unixMode = (externalAttributes >>> 16) & 0o170000;
  return unixMode === 0o040000;
}

// Unix symlinks carry S_IFLNK in the high 16 bits of the external attributes and
// store the link target as the entry content.
function isZipSymbolicLink(entry) {
  const unixMode = (Number(entry.externalFileAttributes || 0) >>> 16) & 0o170000;
  return unixMode === 0o120000;
}

function isZipEncrypted(entry) {
  return Number(entry.generalPurposeBitFlag || 0) % 2 === 1;
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

// Info-ZIP stores an optional UTF-8 name extra field (0x7075) alongside legacy bytes.
function readUnicodePathExtra(entry) {
  const extras = entry.extraFields || [];
  for (const extra of extras) {
    if (extra.id !== INFOZIP_UNICODE_PATH_EXTRA || extra.data.length < 5) continue;
    const expectedCrc = extra.data.readUInt32LE(1);
    if (crc32(entry.fileName) !== expectedCrc) continue;
    return extra.data.slice(5).toString('utf8');
  }
  return null;
}

// yauzl is opened with decodeStrings:false so names without the EFS flag arrive as
// raw bytes instead of being lossily decoded as CP437.
function decodeZipEntryName(entry) {
  const rawName = entry.fileName;
  let decoded;
  if (!Buffer.isBuffer(rawName)) {
    decoded = String(rawName || '');
  } else if (entry.generalPurposeBitFlag & UTF8_NAMES_FLAG) {
    decoded = rawName.toString('utf8');
  } else {
    decoded = readUnicodePathExtra(entry);
    if (decoded === null) decoded = decodeArchiveNameBytes(rawName);
  }
  // Normalize: backslashes to POSIX separators, drop GNU-style "./" prefixes and
  // the trailing slash that marks directory entries (the flag carries that bit).
  return decoded
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { autoClose: true, lazyEntries: true, decodeStrings: false, validateEntrySizes: true },
      (error, zipFile) => {
        if (error) reject(createArchiveError(`Unable to read ZIP archive: ${error.message}`, 422));
        else resolve(zipFile);
      }
    );
  });
}

async function listEntries(filePath) {
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
      const entryName = decodeZipEntryName(entry);
      // Root marker entries ("./") carry no path after normalization.
      if (!entryName) {
        zipFile.readEntry();
        return;
      }
      entries.push({
        path: entryName,
        isDirectory: isZipDirectoryEntry(entry),
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
    zipFile.once('error', error =>
      finish(reject, createArchiveError(`Unable to read ZIP archive: ${error.message}`, 422))
    );
    zipFile.readEntry();
  });
}

function assertZipEntrySafe(entry, entryName) {
  if (!isSafeArchiveEntry(entryName)) {
    throw createArchiveError('Archive contains an unsafe entry path', 422);
  }
  if (isZipEncrypted(entry)) {
    throw createArchiveError('Encrypted archives are not supported', 422);
  }
}

function readStreamBuffer(input, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    input.on('data', chunk => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(createArchiveError('Archive contains a symbolic link with an invalid target', 422));
        input.destroy();
        return;
      }
      chunks.push(chunk);
    });
    input.on('end', () => resolve(Buffer.concat(chunks)));
    input.on('error', reject);
  });
}

// yauzl only supports STORE (0) and DEFLATE (8). Windows Explorer can produce
// Deflate64 (9); callers fall back to 7-Zip for unsupported methods.
async function isSupportedArchive(filePath) {
  const zipFile = await openZip(filePath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      callback(value);
    };
    let supported = true;
    zipFile.on('entry', entry => {
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) supported = false;
      zipFile.readEntry();
    });
    zipFile.once('end', () => finish(resolve, supported));
    zipFile.once('error', error =>
      finish(reject, createArchiveError(`Unable to read ZIP archive: ${error.message}`, 422))
    );
    zipFile.readEntry();
  });
}

async function extract(job, sourcePath, targetPath) {
  const rootRealPath = realpathSync(targetPath);
  const zipFile = await openZip(sourcePath);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (job.child === cancelHandle) job.child = null;
      zipFile.close();
      callback(value);
    };
    const cancelHandle = {
      kill: () => finish(reject, createArchiveError('Archive job cancelled', 499))
    };
    job.child = cancelHandle;
    const next = () => {
      if (!settled) zipFile.readEntry();
    };
    const countEntry = () => {
      job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
    };
    const extractSymlink = (entry, outputPath) => {
      if (Number(entry.uncompressedSize || 0) > MAX_SYMLINK_TARGET_BYTES) {
        finish(reject, createArchiveError('Archive contains a symbolic link with an invalid target', 422));
        return;
      }
      zipFile.openReadStream(entry, async (error, input) => {
        if (error) return finish(reject, createArchiveError(`Unable to extract ZIP archive: ${error.message}`, 422));
        try {
          const link = resolveSafeLinkTarget(
            rootRealPath,
            outputPath,
            decodeArchiveNameBytes(await readStreamBuffer(input, MAX_SYMLINK_TARGET_BYTES))
          );
          mkdirSync(path.dirname(outputPath), { recursive: true });
          createSafeSymlink(outputPath, link.target, link.resolvedPath);
          countEntry();
          next();
        } catch (streamError) {
          finish(reject, streamError);
        }
      });
    };

    zipFile.on('entry', entry => {
      let entryName;
      try {
        entryName = decodeZipEntryName(entry);
        if (!entryName) {
          next();
          return;
        }
        assertZipEntrySafe(entry, entryName);
        const outputPath = path.join(rootRealPath, entryName);
        assertNoEscapingAncestor(rootRealPath, outputPath);
        // Check the link mode before the directory bit: some writers mark
        // symlinks with the DOS directory attribute as well.
        if (isZipSymbolicLink(entry)) {
          extractSymlink(entry, outputPath);
          return;
        }
        if (isZipDirectoryEntry(entry)) {
          mkdirSync(outputPath, { recursive: true });
          countEntry();
          next();
          return;
        }
        mkdirSync(path.dirname(outputPath), { recursive: true });
        zipFile.openReadStream(entry, async (error, input) => {
          if (error) return finish(reject, createArchiveError(`Unable to extract ZIP archive: ${error.message}`, 422));
          try {
            await pipeline(input, createWriteStream(outputPath, { flags: 'wx' }));
            countEntry();
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
    zipFile.once('error', error =>
      finish(reject, createArchiveError(`Unable to read ZIP archive: ${error.message}`, 422))
    );
    zipFile.readEntry();
  });
  // Defense in depth: verify the complete tree after every entry is in place.
  verifyExtractedTree(rootRealPath);
}

module.exports = { extract, isSupportedArchive, listEntries };
