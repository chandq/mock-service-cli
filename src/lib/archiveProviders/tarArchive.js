const { createReadStream, createWriteStream, mkdirSync, realpathSync } = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const tar = require('tar-stream');
const {
  assertNoEscapingAncestor,
  createArchiveError,
  createSafeSymlink,
  decodeArchiveNameBytes,
  isSafeArchiveEntry,
  resolveSafeLinkTarget,
  verifyExtractedTree
} = require('../archiveShared');

// The bundled p7zip 16.02 cannot apply PAX extended headers, so every edition parses
// TAR through tar-stream, which decodes PAX/UTF-8 and GNU long names itself.
function isTarMetadataEntry(header) {
  return ['pax-global-header', 'pax-header', 'gnu-long-path', 'gnu-long-link'].includes(header.type);
}

// TAR marks directories with a trailing slash in the name field; the entry type
// carries that bit, so expose slash-free POSIX paths like the other providers.
// GNU tar also prefixes every name with "./" and emits a root "./" marker entry;
// the marker normalizes to '' and must be skipped rather than rejected.
function normalizeTarName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

// tar-stream is configured with filenameEncoding:'latin1' so raw header bytes
// survive; names are then decoded exactly like ZIP names. PAX values are already
// decoded UTF-8 strings by tar-stream and must not be re-interpreted as bytes.
function decodeTarString(value, alreadyDecoded) {
  const raw = String(value || '');
  if (!raw || alreadyDecoded) return raw;
  return decodeArchiveNameBytes(Buffer.from(raw, 'latin1'));
}

function createFileSource(filePath) {
  const input = createReadStream(filePath);
  return { input, streams: [input] };
}

// Wraps a decompressor factory (createGunzip, or a 7-Zip stdout stream in ultra)
// behind the same source shape: { input, streams }.
function createPipedSource(decompress) {
  return filePath => {
    const input = createReadStream(filePath);
    const decompressor = decompress();
    return { input: input.pipe(decompressor), streams: [input, decompressor] };
  };
}

function destroySource(source) {
  source.streams.forEach(stream => {
    if (typeof stream.destroy === 'function') stream.destroy();
    else if (typeof stream.kill === 'function') stream.kill();
  });
}

function runTar(filePath, createSource, job, onEntry) {
  return new Promise((resolve, reject) => {
    const extractor = tar.extract({ filenameEncoding: 'latin1' });
    const source = createSource(filePath);
    const streams = [...source.streams, extractor];
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (job && job.child === cancelHandle) job.child = null;
      callback(value);
    };
    const fail = error => {
      destroySource(source);
      extractor.destroy();
      const archiveError = error.statusCode
        ? error
        : createArchiveError(`Unable to read TAR archive: ${error.message}`, 422);
      finish(reject, archiveError);
    };
    // The decompression pipeline is in-process streams; expose a kill handle so
    // ArchiveService.cancelJob can interrupt it.
    const cancelHandle = job
      ? { kill: () => fail(createArchiveError('Archive job cancelled', 499)) }
      : null;
    if (job) job.child = cancelHandle;

    streams.forEach(stream => stream.once('error', fail));
    extractor.on('entry', (header, entryStream, next) => {
      Promise.resolve()
        .then(() => {
          if (settled) {
            entryStream.resume();
            return;
          }
          return onEntry(header, entryStream, fail);
        })
        .then(() => {
          if (!settled) next();
        })
        .catch(fail);
    });
    extractor.once('finish', () => finish(resolve));
    source.input.pipe(extractor);
  });
}

// Classifies a raw tar-stream header after normalization.
// - skip: PAX/GNU metadata and empty root marker entries ("./")
// - unsafe: path traversal attempts
// - symlink: created only when its target stays inside the extraction root
// - special: hardlinks/devices (safe to list, never extracted)
function resolveTarEntry(header) {
  if (isTarMetadataEntry(header)) return { skip: true };
  const name = normalizeTarName(decodeTarString(header.name, Boolean(header.pax && header.pax.path)));
  if (!name) return { skip: true };
  if (!isSafeArchiveEntry(name)) return { unsafe: true, name };
  if (header.type === 'symlink') {
    return {
      symlink: true,
      name,
      linkname: decodeTarString(header.linkname, Boolean(header.pax && header.pax.linkpath))
    };
  }
  if (!['file', 'directory'].includes(header.type)) return { special: true, kind: header.type, name };
  return { name, isDirectory: header.type === 'directory' };
}

async function listEntries(filePath, createSource = createFileSource) {
  const entries = [];
  await runTar(filePath, createSource, null, (header, entryStream) =>
    new Promise((resolve, reject) => {
      const resolved = resolveTarEntry(header);
      if (!resolved.skip) {
        entries.push({
          path: resolved.name,
          isDirectory: resolved.isDirectory === true,
          isSymbolicLink: Boolean(resolved.unsafe || resolved.symlink),
          size: Number(header.size || 0),
          packedSize: 0,
          encrypted: false,
          modified: header.mtime ? new Date(header.mtime).toISOString() : null,
          attributes: header.type || ''
        });
      }
      entryStream.once('error', reject);
      entryStream.once('end', resolve);
      entryStream.resume();
    })
  );
  return entries;
}

async function extract(job, sourcePath, targetPath, createSource = createFileSource) {
  const rootRealPath = realpathSync(targetPath);
  const pendingWrites = new Set();
  try {
    await runTar(sourcePath, createSource, job, (header, entryStream) =>
      new Promise((resolve, reject) => {
        const resolved = resolveTarEntry(header);
        if (resolved.skip) {
          entryStream.once('error', reject);
          entryStream.once('end', resolve);
          entryStream.resume();
          return;
        }
        if (resolved.unsafe) {
          reject(createArchiveError('Archive contains an unsafe entry path', 422));
          return;
        }
        if (resolved.special) {
          reject(createArchiveError('Archive contains hard links or device entries that cannot be extracted', 422));
          return;
        }
        const outputPath = path.join(rootRealPath, resolved.name);
        assertNoEscapingAncestor(rootRealPath, outputPath);
        if (resolved.symlink) {
          const link = resolveSafeLinkTarget(rootRealPath, outputPath, resolved.linkname);
          mkdirSync(path.dirname(outputPath), { recursive: true });
          createSafeSymlink(outputPath, link.target, link.resolvedPath);
          entryStream.once('error', reject);
          entryStream.once('end', () => {
            job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
            resolve();
          });
          entryStream.resume();
          return;
        }
        if (resolved.isDirectory) {
          mkdirSync(outputPath, { recursive: true });
          entryStream.once('error', reject);
          entryStream.once('end', () => {
            job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
            resolve();
          });
          entryStream.resume();
          return;
        }
        mkdirSync(path.dirname(outputPath), { recursive: true });
        const write = pipeline(entryStream, createWriteStream(outputPath, { flags: 'wx' }));
        pendingWrites.add(write);
        write
          .then(() => {
            job.progress.processedEntries = Math.min(job.progress.totalEntries, job.progress.processedEntries + 1);
            resolve();
          })
          .catch(reject)
          .finally(() => pendingWrites.delete(write));
      })
    );
  } catch (error) {
    // A cancelled or failed extraction must release the file handles of aborted
    // writes before the caller removes the temporary directory (Windows keeps
    // such directories busy until the handles close).
    await Promise.allSettled([...pendingWrites]);
    throw error;
  }
  // Defense in depth: verify the complete tree after every entry is in place.
  verifyExtractedTree(rootRealPath);
}

module.exports = { createFileSource, createPipedSource, extract, listEntries };
