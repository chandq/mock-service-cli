const express = require('express'),
  bodyParser = require('body-parser'),
  { readdirSync, existsSync, readFileSync, statSync, createReadStream } = require('fs'),
  os = require('os'),
  path = require('path'),
  colors = require('colors/safe'),
  portfinder = require('portfinder'),
  { exec } = require('child_process');
const ifaces = os.networkInterfaces();
const { dateFormat, logger } = require('./utils');

const app = express();
const log = logger(process.env.SILENT);
const argv = JSON.parse(process.env.ARGV);

const explorerRoot = process.env.EXPLORER_DIRECTORY || process.cwd();
const port = argv.p || argv.port;

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
  app.use(crossDomain());
  app.use(bodyParser.json());

  // 文件浏览页面
  app.get('/', (req, res) => {
    const htmlPath = path.resolve(__dirname, './file-explorer.html');
    if (existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('File explorer page not found');
    }
  });

  // 获取目录内容 API
  app.get('/__api/list', (req, res) => {
    let dirPath = req.query.path || '/';
    dirPath = decodeURIComponent(dirPath);

    let fullPath;
    if (dirPath.startsWith('/')) {
      fullPath = dirPath;
    } else {
      fullPath = path.resolve(explorerRoot, dirPath);
    }

    // 防止路径遍历攻击 - 确保路径不会越界
    if (explorerRoot !== '/') {
      const resolvedRoot = path.resolve(explorerRoot);
      if (!fullPath.startsWith(resolvedRoot)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stats = statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    try {
      const files = readdirSync(fullPath, { withFileTypes: true });
      const result = [];

      files.forEach(file => {
        const filePath = path.join(fullPath, file.name);
        let fileStats;
        let hasError = false;

        try {
          fileStats = statSync(filePath);
        } catch (statError) {
          hasError = true;
        }

        const relativePath = path.join(dirPath, file.name);

        // 使用 statSync 的结果，因为 readdirSync 在根目录对某些特殊目录识别不准确
        const isDirectory = hasError ? file.isDirectory() : fileStats.isDirectory();

        result.push({
          name: file.name,
          path: relativePath.replace(/\\/g, '/'),
          isDirectory: isDirectory,
          size: hasError ? 0 : fileStats.size,
          mtime: hasError ? new Date() : fileStats.mtime,
          isHidden: file.name.startsWith('.'),
          error: hasError ? 'Cannot access file' : null
        });
      });

      // 排序：目录在前，文件在后，然后按名称排序
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      res.json({
        currentPath: dirPath,
        parentPath: dirPath === '/' ? null : path.dirname(dirPath).replace(/\\/g, '/'),
        files: result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 文件预览 API
  app.get('/__api/file', (req, res) => {
    let filePath = req.query.path || '/';
    filePath = decodeURIComponent(filePath);

    let fullPath;
    if (filePath.startsWith('/')) {
      fullPath = filePath;
    } else {
      fullPath = path.resolve(explorerRoot, filePath);
    }

    // 防止路径遍历攻击 - 确保路径不会越界
    if (explorerRoot !== '/') {
      const resolvedRoot = path.resolve(explorerRoot);
      if (!fullPath.startsWith(resolvedRoot)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Is a directory' });
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
    let filePath = req.body.path || '/';
    filePath = decodeURIComponent(filePath);

    let fullPath;
    if (filePath.startsWith('/')) {
      fullPath = filePath;
    } else {
      fullPath = path.resolve(explorerRoot, filePath);
    }

    // 防止路径遍历攻击 - 确保路径不会越界
    if (explorerRoot !== '/') {
      const resolvedRoot = path.resolve(explorerRoot);
      if (!fullPath.startsWith(resolvedRoot)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    let openCommand;
    switch (process.platform) {
      case 'darwin':
        openCommand = `open "${fullPath}"`;
        break;
      case 'win32':
        openCommand = `explorer "${fullPath}"`;
        break;
      case 'linux':
        openCommand = `xdg-open "${fullPath}"`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported platform' });
    }

    exec(openCommand, error => {
      if (error) {
        console.error(colors.red(`Failed to open in explorer: ${error.message}`));
        return res.status(500).json({ error: 'Failed to open in explorer' });
      }
      res.json({ success: true, path: fullPath });
    });
  });

  startServer();
}

function crossDomain() {
  return (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') res.status(200);
    next();
  };
}

function startServer() {
  const http = require('http').createServer(app);

  http.listen(Number.parseInt(process.env.PORT, 10), () => {
    console.info(
      [
        colors.yellow(`\nStarting up file-explorer-server, serving `),
        colors.cyan(explorerRoot),
        colors.yellow(`  ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
      ].join('')
    );
    console.info(
      [
        colors.yellow('\n🌍  file-explorer-server version: '),
        colors.cyan(require('../package.json').version),
        '\n'
      ].join('')
    );
    console.info(colors.yellow(`\n File explorer server available on:\n`));
    console.info('    http://localhost:' + colors.green(process.env.PORT));
    Object.keys(ifaces).forEach(function (dev) {
      ifaces[dev].forEach(function (details) {
        if (details.family === 'IPv4') {
          console.info('    http://' + details.address + ':' + colors.green(process.env.PORT));
        }
      });
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

if (process.platform === 'win32') {
  require('readline')
    .createInterface({
      input: process.stdin,
      output: process.stdout
    })
    .on('SIGINT', function () {
      process.emit('SIGINT');
    });
}

process.on('SIGINT', function () {
  log.info(colors.red('file-explorer-server process stopped.'));
  process.exit();
});

process.on('SIGTERM', function () {
  log.info(colors.red('file-explorer-server process stopped.'));
  process.exit();
});
