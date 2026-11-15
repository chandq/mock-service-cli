const test = require('tap').test;
const { expectRejection } = require('./archiveTestHelpers');
const { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync, symlinkSync } = require('fs');
const os = require('os');
const path = require('path');
const { ArchiveService } = require('../src/lib/archiveService');
const lightArchiveProvider = require('../src/lib/archiveProviders/light');

function createService(root) {
  const resolvePath = inputPath => path.resolve(root, String(inputPath || '/').replace(/^\/+/, ''));
  return new ArchiveService({
    rootPath: realpathSync(root),
    resolvePath,
    getChildPath: (parentPath, name) => path.resolve(resolvePath(parentPath), name)
  });
}

function waitForJob(service, id) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const job = service.getJob(id);
      if (!['completed', 'failed', 'cancelled'].includes(job.status)) return;
      clearInterval(timer);
      if (job.status === 'completed') resolve(job);
      else reject(new Error(job.error || 'Archive job did not complete'));
    }, 20);
  });
}

test('ArchiveService creates, previews, extracts, rejects conflicts, and cancels queued work', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-archive-'));
  const service = createService(root);
  mkdirSync(path.join(root, 'source'));
  writeFileSync(path.join(root, 'source', 'hello.txt'), 'hello archive');

  try {
    const createJob = service.startJob('create', {
      sources: ['/source'],
      destinationPath: '/',
      name: 'bundle',
      format: 'zip'
    });
    await waitForJob(service, createJob.id);
    t.ok(existsSync(path.join(root, 'bundle.zip')), 'creates a ZIP archive');

    const preview = await service.listArchive('/bundle.zip');
    t.equal(preview.totalEntries, 1, 'lists archive entries');
    t.equal(preview.entries[0].path, 'source/hello.txt', 'keeps the source directory in the archive');
    t.ok(preview.totalPackedSize > 0, 'reports the ZIP packed size');

    const tarJob = service.startJob('create', {
      sources: ['/source'],
      destinationPath: '/',
      name: 'bundle-tar',
      format: 'tar.gz'
    });
    await waitForJob(service, tarJob.id);
    t.ok(existsSync(path.join(root, 'bundle-tar.tar.gz')), 'creates a TAR.GZ archive');
    const tarPreview = await service.listArchive('/bundle-tar.tar.gz');
    t.equal(tarPreview.entries[0].path, 'source/hello.txt', 'previews TAR.GZ entries');
    t.ok(tarPreview.totalPackedSize > 0, 'reports the TAR.GZ packed size instead of 0 B');

    t.same(
      lightArchiveProvider.capabilities,
      {
        edition: 'light',
        createFormats: ['zip', 'tar.gz'],
        readExtensions: ['tar.gz', 'tgz', 'zip', 'tar']
      },
      'light provider advertises only lightweight formats'
    );
    const lightZipEntries = await lightArchiveProvider.listEntries(path.join(root, 'bundle.zip'));
    t.equal(lightZipEntries[0].path, 'source/hello.txt', 'light provider previews ZIP archives');
    t.equal(
      (await lightArchiveProvider.listEntries(path.join(root, 'bundle-tar.tar.gz')))[0].path,
      'source/hello.txt',
      'light provider previews TAR.GZ archives'
    );
    const lightOutput = path.join(root, 'light-output');
    mkdirSync(lightOutput);
    const lightJob = { progress: { processedEntries: 0, totalEntries: 1 } };
    await lightArchiveProvider.extract(lightJob, path.join(root, 'bundle.zip'), lightOutput);
    t.equal(
      readFileSync(path.join(lightOutput, 'source', 'hello.txt'), 'utf8'),
      'hello archive',
      'light provider extracts ZIP archives'
    );

    const conflictJob = service.startJob('extract', { path: '/bundle.zip', destinationPath: '/' });
    await expectRejection(
      t,
      waitForJob(service, conflictJob.id),
      /Destination already contains source/,
      'refuses extraction conflicts'
    );
    t.equal(
      readFileSync(path.join(root, 'source', 'hello.txt'), 'utf8'),
      'hello archive',
      'does not overwrite existing files'
    );

    rmSync(path.join(root, 'source'), { recursive: true, force: true });
    const extractJob = service.startJob('extract', { path: '/bundle.zip', destinationPath: '/' });
    await waitForJob(service, extractJob.id);
    t.equal(
      readFileSync(path.join(root, 'source', 'hello.txt'), 'utf8'),
      'hello archive',
      'extracts the archive after conflict removal'
    );

    const cancelledJob = service.startJob('create', {
      sources: ['/source'],
      destinationPath: '/',
      name: 'cancelled',
      format: 'zip'
    });
    service.cancelJob(cancelledJob.id);
    await new Promise(resolve => setTimeout(resolve, 30));
    t.equal(service.getJob(cancelledJob.id).status, 'cancelled', 'cancels a queued archive job');
    t.notOk(existsSync(path.join(root, 'cancelled.zip')), 'does not create a cancelled archive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ArchiveService archives a selected in-root symbolic link as a link', async t => {
  if (process.platform === 'win32') {
    t.skip('symbolic link fixture requires the Windows symlink privilege');
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'mock-service-cli-service-link-create-'));
  const service = createService(root);
  try {
    writeFileSync(path.join(root, 'target.txt'), 'target');
    symlinkSync('target.txt', path.join(root, 'link.txt'));
    const job = service.startJob('create', {
      sources: ['/link.txt'],
      destinationPath: '/',
      name: 'link',
      format: 'zip'
    });
    await waitForJob(service, job.id);
    const preview = await service.listArchive('/link.zip');
    t.equal(preview.entries[0].path, 'link.txt', 'stores the selected link under its own name');
    t.ok(preview.entries[0].isSymbolicLink, 'stores the selected link as a link instead of rejecting it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
