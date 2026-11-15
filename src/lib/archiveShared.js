const { lstatSync, readlinkSync, readdirSync, realpathSync, symlinkSync, writeFileSync } = require('fs');
const path = require('path');
const { decodeFileNameBytes } = require('./utils');

// Link privileges are not granted to every Windows account; Git solves the same
// problem by storing the link target as a regular file.
const WINDOWS_LINK_FALLBACK_CODES = new Set(['EPERM', 'EACCES', 'UNKNOWN']);

function createArchiveError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isSafeArchiveEntry(entryPath) {
  const normalized = String(entryPath || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (!normalized || normalized.includes('\0')) return false;
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  return normalized.split('/').every(part => part && part !== '.' && part !== '..');
}

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasArchiveExtension(filePath, extensions) {
  const lower = String(filePath || '').toLowerCase();
  return extensions.some(extension => lower.endsWith(extension));
}

// Entry names written by legacy Windows tools are GBK/GB18030, not UTF-8. Valid
// UTF-8 (with or without the ZIP EFS flag) is decoded first so multi-language
// archives keep working, then the Chinese Windows default is assumed.
function decodeArchiveNameBytes(buffer) {
  return decodeFileNameBytes(buffer);
}

// Validates a symbolic-link target before the link is created. Only relative
// targets that stay inside the extraction root are accepted; absolute, drive and
// UNC targets are rejected. Returns the normalized target (POSIX separators) plus
// the lexically resolved path used for Windows junctions.
function resolveSafeLinkTarget(rootPath, linkPath, target) {
  const normalized = typeof target === 'string' ? target.replace(/\0+$/, '').replace(/\\/g, '/') : '';
  if (!normalized || normalized.includes('\0')) {
    throw createArchiveError('Archive contains a symbolic link with an invalid target', 422);
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw createArchiveError('Archive contains a symbolic link pointing outside the extraction folder', 422);
  }
  const resolvedPath = path.resolve(path.dirname(linkPath), normalized);
  if (!isInside(rootPath, resolvedPath)) {
    throw createArchiveError('Archive contains a symbolic link pointing outside the extraction folder', 422);
  }
  return { target: normalized, resolvedPath };
}

function createSafeSymlink(linkPath, target, resolvedPath) {
  try {
    if (process.platform === 'win32') {
      try {
        let stats = null;
        try {
          stats = lstatSync(resolvedPath);
        } catch (error) {
          stats = null;
        }
        // Junctions cover directory links without the symlink privilege.
        if (stats && stats.isDirectory()) symlinkSync(resolvedPath, linkPath, 'junction');
        else symlinkSync(target, linkPath);
        return;
      } catch (error) {
        if (!WINDOWS_LINK_FALLBACK_CODES.has(error.code)) throw error;
        writeFileSync(linkPath, target, { flag: 'wx' });
        return;
      }
    }
    symlinkSync(target, linkPath);
  } catch (error) {
    throw createArchiveError(`Unable to create symbolic link ${linkPath}: ${error.message}`, 422);
  }
}

// Blocks the classic "escaping directory symlink + file written through it"
// attack by checking every existing ancestor of an output path at write time.
function assertNoEscapingAncestor(rootRealPath, outputPath) {
  let current = path.dirname(outputPath);
  while (isInside(rootRealPath, current)) {
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      break;
    }
    if (stats.isSymbolicLink()) {
      let realPath;
      try {
        realPath = realpathSync(current);
      } catch (error) {
        const resolved = path.resolve(current, readlinkSync(current));
        if (!isInside(rootRealPath, resolved)) {
          throw createArchiveError('Archive contains a symbolic link pointing outside the extraction folder', 422);
        }
        return;
      }
      if (!isInside(rootRealPath, realPath)) {
        throw createArchiveError('Archive contains a symbolic link pointing outside the extraction folder', 422);
      }
    }
    if (current === path.dirname(current)) break;
    current = path.dirname(current);
  }
}

// Final defense-in-depth pass after extraction: every symlink must resolve
// inside the root, and no regular entry may escape through a linked directory.
function verifyExtractedTree(rootPath) {
  const rootRealPath = realpathSync(rootPath);
  const walk = current => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const stats = lstatSync(child);
      if (stats.isSymbolicLink()) {
        let targetRealPath;
        try {
          targetRealPath = realpathSync(child);
        } catch (error) {
          // Dangling link or link loop: validate the lexical target instead.
          const targetPath = path.resolve(path.dirname(child), readlinkSync(child));
          if (!isInside(rootRealPath, targetPath)) {
            throw createArchiveError('Archive contains a symbolic link pointing outside the extraction folder', 422);
          }
          continue;
        }
        if (!isInside(rootRealPath, targetRealPath)) {
          throw createArchiveError('Archive contains a symbolic link pointing outside the extraction folder', 422);
        }
        // Never recurse through a symlink; linked directories are reached via
        // their own real directory entries in the archive.
        continue;
      }
      if (!isInside(rootRealPath, realpathSync(child))) {
        throw createArchiveError('Archive extracted outside its destination', 422);
      }
      if (stats.isDirectory()) walk(child);
    }
  };
  walk(rootRealPath);
}

module.exports = {
  assertNoEscapingAncestor,
  createArchiveError,
  createSafeSymlink,
  decodeArchiveNameBytes,
  hasArchiveExtension,
  isInside,
  isSafeArchiveEntry,
  resolveSafeLinkTarget,
  verifyExtractedTree
};
