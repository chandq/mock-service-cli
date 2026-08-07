const express = require('express');
const {
  existsSync,
  readFileSync,
  statSync,
  lstatSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  realpathSync,
  copyFileSync,
  unlinkSync,
  constants: fsConstants,
  promises: fsPromises
} = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const { UAParser } = require('ua-parser-js');
const colors = require('colors/safe');
const portfinder = require('portfinder');
const { exec, execFile } = require('child_process');
const {
  dateFormat,
  logger,
  getServerHost,
  getServerUrls,
  hostAllowlistMiddleware,
  normalizeRemoteAddress
} = require('./utils');
const { getPackageVersion } = require('./packageInfo');
const { ArchiveService } = require('./archiveService');

const app = express();
const log = logger(process.env.SILENT);
const argv = JSON.parse(process.env.ARGV);

const explorerRoot = path.resolve(process.env.EXPLORER_DIRECTORY || process.cwd());
const explorerRootRealPath = realpathSync(explorerRoot);
const explorerRootId = crypto.createHash('sha256').update(explorerRootRealPath).digest('hex');
const port = argv.p || argv.port;
const isEditMode = process.env.EXPLORER_EDIT === 'true';
const explorerPassword = process.env.EXPLORER_AUTH || '';
const isAuthEnabled = Boolean(explorerPassword);
const visitorKeys = new Set();
let httpServer = null;
let shuttingDown = false;
const MAX_UPLOAD_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_FILE_COUNT = 100;
const MAX_MULTIPART_OVERHEAD_SIZE = 2 * 1024 * 1024;
const upload = multer({
  dest: path.join(os.tmpdir(), 'mock-service-cli-upload'),
  preservePath: true,
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE, files: MAX_UPLOAD_FILE_COUNT, fields: 10 }
});
const archiveService = new ArchiveService({
  rootPath: explorerRootRealPath,
  resolvePath: resolveExplorerPath,
  getChildPath
});

function isPathInsideRoot(fullPath, resolvedRoot = explorerRootRealPath) {
  const relativePath = path.relative(resolvedRoot, fullPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeExplorerInputPath(inputPath) {
  const decodedPath = decodeURIComponent(String(inputPath || '/')).replace(/\\/g, '/');
  if (!decodedPath || decodedPath === '.') {
    return '/';
  }

  return decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;
}

function resolveExplorerPath(inputPath) {
  const targetPath = normalizeExplorerInputPath(inputPath);
  const relativePath = targetPath.replace(/^\/+/, '');
  const fullPath = path.resolve(explorerRoot, relativePath);

  if (!isPathInsideRoot(fullPath, explorerRoot)) {
    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }

  if (!existsSync(fullPath)) {
    return fullPath;
  }

  const realPath = realpathSync(fullPath);
  if (!isPathInsideRoot(realPath)) {
    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }

  return realPath;
}

function validateEntryName(name) {
  if (typeof name !== 'string') {
    return 'Name must be a string';
  }

  const normalizedName = name.trim();
  if (!normalizedName || normalizedName === '.' || normalizedName === '..') {
    return 'Invalid name';
  }

  if (/[/\\\0<>:"|?*]/.test(normalizedName)) {
    return 'Name contains invalid characters';
  }

  if (process.platform === 'win32') {
    const upperName = normalizedName
      .replace(/[. ]+$/g, '')
      .split('.')[0]
      .toUpperCase();
    const reservedNames = new Set([
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9'
    ]);

    if (reservedNames.has(upperName) || normalizedName.endsWith(' ') || normalizedName.endsWith('.')) {
      return 'Name is not supported on Windows';
    }
  }

  return null;
}

function getChildPath(parentPath, name) {
  const nameError = validateEntryName(name);
  if (nameError) {
    const error = new Error(nameError);
    error.statusCode = 400;
    throw error;
  }

  const parentFullPath = resolveExplorerPath(parentPath || '/');
  if (!existsSync(parentFullPath) || !statSync(parentFullPath).isDirectory()) {
    const error = new Error('Parent directory not found');
    error.statusCode = 404;
    throw error;
  }

  const childPath = path.resolve(parentFullPath, name.trim());
  if (!isPathInsideRoot(childPath)) {
    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }

  return childPath;
}

function requireEditMode(req, res, next) {
  if (!isEditMode) {
    return res.status(403).json({ error: 'File explorer is read-only. Restart with --edit to modify files.' });
  }
  next();
}

function isValidExplorerPassword(value) {
  if (!isAuthEnabled) return true;
  const provided = Buffer.from(String(value || ''));
  const expected = Buffer.from(explorerPassword);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function getExplorerPassword(req) {
  return req.get('x-file-explorer-password') || (req.body && req.body.password);
}

function requireExplorerAuth(req, res, next) {
  if (!isValidExplorerPassword(getExplorerPassword(req))) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function logExplorerVisit(req) {
  const userAgent = req.get('user-agent') || '';
  const ip = normalizeRemoteAddress(req.socket && req.socket.remoteAddress);
  const visitorKey = `${ip}\n${userAgent}`;
  if (visitorKeys.has(visitorKey)) return;
  visitorKeys.add(visitorKey);
  const parsed = new UAParser(userAgent).getResult();
  const browser = [parsed.browser.name, parsed.browser.version].filter(Boolean).join(' ') || 'Unknown';
  const operatingSystem = [parsed.os.name, parsed.os.version].filter(Boolean).join(' ') || 'Unknown';
  log.info(`File explorer visitor: ip=${ip}, os=${operatingSystem}, browser=${browser}, userAgent=${userAgent}`);
}

function getUploadTargetPath(parentPath, originalName) {
  const normalizedName = String(originalName || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const parts = normalizedName.split('/').filter(Boolean);
  if (parts.length === 0 || normalizedName !== parts.join('/')) {
    const error = new Error('Invalid upload path');
    error.statusCode = 400;
    throw error;
  }
  parts.forEach(part => {
    const nameError = validateEntryName(part);
    if (nameError) {
      const error = new Error(nameError);
      error.statusCode = 400;
      throw error;
    }
  });

  const parentFullPath = resolveExplorerPath(parentPath || '/');
  if (!existsSync(parentFullPath) || !statSync(parentFullPath).isDirectory()) {
    const error = new Error('Parent directory not found');
    error.statusCode = 404;
    throw error;
  }
  const targetPath = path.resolve(parentFullPath, ...parts);
  if (!isPathInsideRoot(targetPath)) {
    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }
  return { targetPath, parentFullPath, parts };
}

function ensureUploadParent(parentFullPath, parts) {
  let current = parentFullPath;
  parts.slice(0, -1).forEach(part => {
    current = path.join(current, part);
    if (existsSync(current)) {
      const stats = lstatSync(current);
      if (!stats.isDirectory() || stats.isSymbolicLink() || !isPathInsideRoot(realpathSync(current))) {
        const error = new Error('Upload path is not a safe directory');
        error.statusCode = 403;
        throw error;
      }
    } else {
      mkdirSync(current);
    }
  });
}

function moveUploadedFile(sourcePath, targetPath) {
  copyFileSync(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
  unlinkSync(sourcePath);
}

function cleanupUploadedTempFiles(files = []) {
  files.forEach(file => {
    if (file && file.path && existsSync(file.path)) rmSync(file.path, { force: true });
  });
}

function enforceUploadRequestSize(req, res, next) {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_TOTAL_SIZE + MAX_MULTIPART_OVERHEAD_SIZE) {
    return res.status(413).json({ error: 'Total upload size exceeds 2GB limit' });
  }
  next();
}

function deleteExplorerPath(targetPath) {
  const fullPath = resolveExplorerPath(targetPath);

  if (path.resolve(fullPath) === explorerRootRealPath) {
    const error = new Error('Cannot delete explorer root');
    error.statusCode = 400;
    throw error;
  }

  if (!existsSync(fullPath)) {
    const error = new Error('Path not found');
    error.statusCode = 404;
    throw error;
  }

  rmSync(fullPath, { recursive: true, force: false });
}

if (!process.env.PORT) {
  portfinder.basePort = port || 8090;
  portfinder.getPort(function (err, foundPort) {
    if (err) {
      throw err;
    }
    process.env.PORT = foundPort;
    init();
  });
} else {
  init();
}

function init() {
  app.use(hostAllowlistMiddleware());
  app.use(express.json());
  const faviconInstanceId = crypto.randomUUID();
  const explorerFaviconUrl = `/favicon-file-explorer.svg?instance=${faviconInstanceId}`;
  const loginFaviconUrl = `/favicon-file-explorer-login.svg?instance=${faviconInstanceId}`;
  const sendFavicon = (filename, res) => {
    res.type('image/svg+xml').set('Cache-Control', 'no-store').sendFile(path.resolve(__dirname, filename));
  };
  const sendExplorerPage = (filename, faviconUrl, res) => {
    const htmlPath = path.resolve(__dirname, filename);
    if (!existsSync(htmlPath)) return res.status(404).send('File explorer page not found');
    res.type('html').send(readFileSync(htmlPath, 'utf8').replace('__FILE_EXPLORER_FAVICON_URL__', faviconUrl));
  };
  app.get('/favicon-file-explorer.svg', (req, res) => sendFavicon('./favicon-file-explorer.svg', res));
  app.get('/favicon-file-explorer-login.svg', (req, res) => sendFavicon('./favicon-file-explorer-login.svg', res));

  // 文件浏览页面
  app.get('/', (req, res) => sendExplorerPage('./file-explorer.html', explorerFaviconUrl, res));

  app.get('/__login', (req, res) => sendExplorerPage('./file-explorer-login.html', loginFaviconUrl, res));

  app.post('/__api/auth/verify', (req, res) => {
    if (!isValidExplorerPassword(getExplorerPassword(req))) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    res.json({ success: true, authEnabled: isAuthEnabled });
  });

  app.use('/__api', requireExplorerAuth);

  app.get('/__api/config', (req, res) => {
    logExplorerVisit(req);
    res.json({ editMode: isEditMode, authEnabled: isAuthEnabled, rootId: explorerRootId });
  });

  app.get('/__api/archive/capabilities', requireEditMode, (req, res) => {
    res.json(archiveService.getCapabilities());
  });

  app.get('/__api/health', (req, res) => {
    res.json({ success: true });
  });

  // 获取目录内容 API
  app.get('/__api/list', async (req, res) => {
    const dirPath = normalizeExplorerInputPath(req.query.path || '/');

    let fullPath;
    try {
      fullPath = resolveExplorerPath(dirPath);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    try {
      const stats = await fsPromises.lstat(fullPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
      }
      const files = await fsPromises.readdir(fullPath, { withFileTypes: true });
      const result = await Promise.all(
        files.map(async file => {
          const filePath = path.join(fullPath, file.name);
          let fileStats;
          let hasError = false;

          try {
            fileStats = await fsPromises.lstat(filePath);
          } catch (statError) {
            hasError = true;
          }

          const relativePath = path.posix.join(dirPath, file.name);

          // lstat avoids following symlinks outside the explorer root.
          const isDirectory = hasError ? file.isDirectory() : fileStats.isDirectory();

          return {
            name: file.name,
            path: relativePath.replace(/\\/g, '/'),
            isDirectory: isDirectory,
            size: hasError ? 0 : fileStats.size,
            mtime: hasError ? new Date() : fileStats.mtime,
            birthtime: hasError ? new Date() : fileStats.birthtime,
            isHidden: file.name.startsWith('.'),
            error: hasError ? 'Cannot access file' : null
          };
        })
      );

      // 排序：目录在前，文件在后，然后按名称排序
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      res.json({
        currentPath: dirPath,
        parentPath: dirPath === '/' ? null : path.posix.dirname(dirPath),
        files: result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 文件预览 API
  app.get('/__api/file', (req, res) => {
    const filePath = normalizeExplorerInputPath(req.query.path || '/');

    let fullPath;
    try {
      fullPath = resolveExplorerPath(filePath);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Is a directory' });
    }

    // Preview responses may be JSON, but downloads must always stream the original bytes.
    if (req.query.download === '1') {
      return res.download(fullPath, path.basename(filePath));
    }

    const ext = path.extname(filePath).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
    const textExts = ['.txt', '.json', '.js', '.css', '.html', '.xml', '.md', '.csv', '.yaml', '.yml', '.log'];

    if (imageExts.includes(ext)) {
      res.sendFile(fullPath);
    } else if (textExts.includes(ext) || stats.size < 1024 * 1024) {
      // 小于1MB的文件尝试作为文本读取
      try {
        const content = readFileSync(fullPath, 'utf-8');
        res.json({
          name: path.basename(filePath),
          type: 'text',
          content: content,
          size: stats.size
        });
      } catch (error) {
        // 如果不能作为文本读取，直接提供下载
        res.download(fullPath);
      }
    } else {
      res.download(fullPath);
    }
  });

  // 在系统文件管理器中打开目录/文件 API
  app.post('/__api/open-in-explorer', (req, res) => {
    const filePath = normalizeExplorerInputPath(req.body.path || '/');

    let fullPath;
    try {
      fullPath = resolveExplorerPath(filePath);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    let command;
    let args;
    switch (process.platform) {
      case 'darwin':
        command = 'open';
        args = [fullPath];
        break;
      case 'win32':
        command = 'explorer.exe';
        args = [fullPath];
        break;
      case 'linux':
        command = 'xdg-open';
        args = [fullPath];
        break;
      default:
        return res.status(400).json({ error: 'Unsupported platform' });
    }

    execFile(command, args, error => {
      if (error) {
        console.error(colors.red(`Failed to open in explorer: ${error.message}`));
        return res.status(500).json({ error: 'Failed to open in explorer' });
      }
      res.json({ success: true, path: fullPath });
    });
  });

  // 新建目录/文件 API
  app.post('/__api/path', requireEditMode, (req, res) => {
    const parentPath = (req.body && req.body.parentPath) || '/';
    const name = req.body && req.body.name;
    const type = (req.body && req.body.type) || 'file';

    if (type !== 'file' && type !== 'directory') {
      return res.status(400).json({ error: 'Invalid type' });
    }

    let fullPath;
    try {
      fullPath = getChildPath(parentPath, name);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }

    if (existsSync(fullPath)) {
      return res.status(409).json({ error: 'Path already exists' });
    }

    try {
      if (type === 'directory') {
        mkdirSync(fullPath);
      } else {
        writeFileSync(fullPath, '');
      }
      res.json({ success: true, path: fullPath });
    } catch (error) {
      console.error(colors.red(`Failed to create path: ${error.message}`));
      res.status(500).json({ error: 'Failed to create path' });
    }
  });

  // 重命名目录/文件 API
  app.patch('/__api/path', requireEditMode, (req, res) => {
    const sourcePath = req.body && req.body.path;
    const name = req.body && req.body.name;

    let fullPath;
    let nextPath;
    try {
      fullPath = resolveExplorerPath(sourcePath);
      if (path.resolve(fullPath) === explorerRootRealPath) {
        return res.status(400).json({ error: 'Cannot rename explorer root' });
      }
      if (!existsSync(fullPath)) {
        return res.status(404).json({ error: 'Path not found' });
      }
      nextPath = getChildPath(path.posix.dirname(normalizeExplorerInputPath(sourcePath || '/')), name);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }

    if (existsSync(nextPath)) {
      return res.status(409).json({ error: 'Path already exists' });
    }

    try {
      renameSync(fullPath, nextPath);
      res.json({ success: true, path: sourcePath, nextPath: nextPath });
    } catch (error) {
      console.error(colors.red(`Failed to rename path: ${error.message}`));
      res.status(500).json({ error: 'Failed to rename path' });
    }
  });

  // 删除目录/文件 API
  app.delete('/__api/path', requireEditMode, (req, res) => {
    const targetPath = (req.body && req.body.path) || '/';

    try {
      deleteExplorerPath(targetPath);
      res.json({ success: true, path: targetPath });
    } catch (error) {
      console.error(colors.red(`Failed to delete path: ${error.message}`));
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to delete path' });
    }
  });

  // 批量删除目录/文件 API
  app.delete('/__api/paths', requireEditMode, (req, res) => {
    const paths = (req.body && req.body.paths) || [];

    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'Paths must be a non-empty array' });
    }

    const deleted = [];
    try {
      paths.forEach(targetPath => {
        deleteExplorerPath(targetPath);
        deleted.push(targetPath);
      });
      res.json({ success: true, deleted });
    } catch (error) {
      console.error(colors.red(`Failed to delete paths: ${error.message}`));
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : 'Failed to delete paths',
        deleted
      });
    }
  });

  app.post('/__api/upload', requireEditMode, enforceUploadRequestSize, upload.any(), (req, res) => {
    const parentPath = (req.body && req.body.parentPath) || '/';
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_UPLOAD_TOTAL_SIZE) {
      cleanupUploadedTempFiles(files);
      return res.status(413).json({ error: 'Total upload size exceeds 2GB limit' });
    }

    const uploaded = [];
    const failed = [];
    files.forEach(file => {
      try {
        const { targetPath, parentFullPath, parts } = getUploadTargetPath(parentPath, file.originalname);
        if (existsSync(targetPath)) {
          failed.push({ name: file.originalname, error: 'Path already exists', statusCode: 409 });
          return;
        }
        ensureUploadParent(parentFullPath, parts);
        if (existsSync(targetPath)) {
          failed.push({ name: file.originalname, error: 'Path already exists', statusCode: 409 });
          return;
        }
        moveUploadedFile(file.path, targetPath);
        uploaded.push({
          name: file.originalname,
          path: path.posix.join(normalizeExplorerInputPath(parentPath), ...parts)
        });
      } catch (error) {
        failed.push({ name: file.originalname, error: error.message, statusCode: error.statusCode || 500 });
      } finally {
        if (existsSync(file.path)) rmSync(file.path, { force: true });
      }
    });

    res.status(failed.length ? 207 : 200).json({ success: failed.length === 0, uploaded, failed });
  });

  app.get('/__api/archive/preview', requireEditMode, async (req, res) => {
    try {
      const preview = await archiveService.listArchive(normalizeExplorerInputPath(req.query.path || '/'));
      res.json(preview);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.post('/__api/archive/jobs', requireEditMode, (req, res) => {
    const payload = req.body || {};
    const operation = payload.operation;
    if (operation !== 'create' && operation !== 'extract') {
      return res.status(400).json({ error: 'Archive operation must be create or extract' });
    }
    try {
      const job = archiveService.startJob(operation, payload);
      res.status(202).json({ id: job.id, status: job.status, type: job.type });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.get('/__api/archive/jobs/:id', requireEditMode, (req, res) => {
    const job = archiveService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Archive job not found' });
    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null
    });
  });

  app.delete('/__api/archive/jobs/:id', requireEditMode, (req, res) => {
    try {
      const job = archiveService.cancelJob(req.params.id);
      res.json({ id: job.id, status: job.status });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      cleanupUploadedTempFiles(req.files);
      const statusCode = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' ? 413 : 400;
      return res.status(statusCode).json({ error: error.message });
    }
    if (error) {
      console.error(colors.red(`File explorer request failed: ${error.message}`));
      return res.status(error.statusCode || 500).json({ error: error.message || 'Request failed' });
    }
    next();
  });

  startServer();
}

function startServer() {
  httpServer = require('http').createServer(app);
  // Large LAN uploads may legitimately take longer than Node's five-minute default.
  httpServer.requestTimeout = 0;

  httpServer.listen(Number.parseInt(process.env.PORT, 10), getServerHost(), () => {
    console.info(
      [
        colors.yellow(`\nStarting up file-explorer-server, serving `),
        colors.cyan(explorerRoot),
        colors.yellow(`  ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
      ].join('')
    );
    console.info(
      [colors.yellow('\n🌍  file-explorer-server version: '), colors.cyan(getPackageVersion()), '\n'].join('')
    );
    console.info(colors.yellow(`\n File explorer server available on:\n`));
    getServerUrls(process.env.PORT).forEach(url => {
      console.info('    ' + url.replace(String(process.env.PORT), colors.green(process.env.PORT)));
    });

    // 自动打开浏览器
    if (process.env.OPEN_API_OVERVIEW && !process.env.RESTARTED) {
      const url = `http://localhost:${process.env.PORT}`;
      console.info(colors.yellow(`\nOpening file explorer...`));
      let openCommand;
      switch (process.platform) {
        case 'darwin':
          openCommand = `open ${url}`;
          break;
        case 'win32':
          openCommand = `start ${url}`;
          break;
        case 'linux':
          openCommand = `xdg-open ${url}`;
          break;
        default:
          console.warn(colors.yellow(`Could not automatically open browser. Please visit: ${url}`));
          return;
      }
      exec(openCommand, error => {
        if (error) {
          console.warn(colors.yellow(`Could not automatically open browser. Please visit: ${url}`));
        }
      });
    }
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    // Uploads and keep-alive connections must not keep the listening socket alive.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  closeServer(httpServer).finally(() => {
    log.info(colors.red('file-explorer-server process stopped.'));
    process.exit();
  });
}

if (process.platform === 'win32') {
  // On Windows, readline receives Ctrl+C from the console input stream;
  // forward it so the normal process-level shutdown handler runs.
  require('readline')
    .createInterface({
      input: process.stdin,
      output: process.stdout
    })
    .on('SIGINT', function () {
      process.emit('SIGINT');
    });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
