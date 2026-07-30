const path = require('path');

function createArchiveError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isSafeArchiveEntry(entryPath) {
  const normalized = String(entryPath || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
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

module.exports = {
  createArchiveError,
  hasArchiveExtension,
  isInside,
  isSafeArchiveEntry
};
