const { createGunzip } = require('zlib');
const tarArchive = require('./tarArchive');
const zipArchive = require('./zipArchive');
const { hasArchiveExtension } = require('../archiveShared');

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

function tarSource(filePath) {
  return isCompressedTarPath(filePath)
    ? tarArchive.createPipedSource(createGunzip)(filePath)
    : tarArchive.createFileSource(filePath);
}

function listEntries(filePath) {
  return isZipPath(filePath) ? zipArchive.listEntries(filePath) : tarArchive.listEntries(filePath, tarSource);
}

function extract(job, sourcePath, targetPath) {
  return isZipPath(sourcePath)
    ? zipArchive.extract(job, sourcePath, targetPath)
    : tarArchive.extract(job, sourcePath, targetPath, tarSource);
}

module.exports = { capabilities, extract, isArchivePath, listEntries };
