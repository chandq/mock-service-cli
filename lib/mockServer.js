const express = require('express'), // 引入express
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  colors = require('colors/safe'),
  portfinder = require('portfinder'),
  chalk = require('chalk');
const ifaces = os.networkInterfaces();
const { Server } = require('socket.io');
const { dateFormat, logger, SupportMethods, getFileLatestContent } = require('./utils');
const { genMockFiles, getMockStatFromDir, getMockStatFromFile } = require('./manageMockFiles');

const methodRegExp = new RegExp(`(${SupportMethods.join('|')}) +(.*)`, 'i');

const app = express();
const log = logger(process.env.SILENT);
let socketServer = null; // Socket server instance

let count = 0,
  fileCount = 0; // 记录mock api个数,mock file个数
let done = false;
if (!process.env.PORT) {
  portfinder.basePort = 8090;
  portfinder.getPort(function (err, port) {
    if (err) {
      throw err;
    }
    process.env.PORT = port;
    done = true;
  });
} else {
  done = true;
}
// 将异步函数转换为同步代码代码执行
require('deasync').loopWhile(function () {
  return !done;
});
/**
 * @description: 跨域设置
 * @param {*}
 * @return {*}
 */
const crossDomain = () => (req, res, next) => {
  // 设置withCredentials: true时,需设置以下两项
  res.header('Access-Control-Allow-Credentials', true);
  // res.header('Access-Control-Allow-Origin', 'http://localhost:8081');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', SupportMethods.join(','));
  // res.header(
  //     'Access-Control-Allow-Headers',
  //     'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  // );
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') res.status(200); // 让OPTIONS快速返回
  next();
};

/**
 * @description: 构建本地服务的路由请求
 * @param {*} file
 * @returns {*}
 */
const composeRoute = function (file) {
  // 先删除require之前导入的缓存文件,否则获取到的文件内容还是旧内容
  const fileObject = getFileLatestContent(file);

  log.info(colors.green(`Mockfile ${++fileCount}: `), file, colors.yellow('all API URL is follows: '));
  Object.keys(fileObject).forEach(item => {
    let reqMethod = 'get',
      reqUrl = item;
    // 支持(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS|COPY|LINK|UNLINK|PURGE)常用方法, 默认GET请求
    if (methodRegExp.exec(item)) {
      const [, method, url] = methodRegExp.exec(item);
      reqMethod = method.toLowerCase();
      reqUrl = url;
    }
    log.info(colors.yellow(`path ${++count}: `), item, colors.blue(typeof fileObject[item]));
    if (typeof fileObject[item] === 'function') {
      app[reqMethod](reqUrl, fileObject[item]);
    } else if (typeof fileObject[item] === 'object') {
      app[reqMethod](reqUrl, function (req, res) {
        res.json(fileObject[item]);
      });
    }
  });
};
/**
 * @description: 解析mock目录下的js文件，为构建路由请求做准备
 * @param {string} specialDir 目录路径
 * @return {void}
 */
const parseMockFiles = function (specialDir = '../mock') {
  const files = fs.readdirSync(path.resolve(__dirname, specialDir), { withFileTypes: true });
  const curFilesSize = files.length;
  for (let index = 0; index < curFilesSize; index++) {
    const el = files[index];
    const filePath = path.normalize(`${specialDir}/${el.name}`);
    // 递归目录
    if (!el.isFile()) {
      parseMockFiles(filePath);
    }

    // 处理存放mock数据的json文件
    if (el.name.endsWith('.json') && el.name !== 'mock-list.json') {
      log.info(colors.green(`Mockfile ${++fileCount}: `), filePath, colors.yellow('all API URL is follows: '));
      const fileObject = getFileLatestContent(filePath);
      Object.keys(fileObject).forEach(method => {
        const apiUrl = decodeURIComponent(el.name.split('.')[0]);
        log.info(colors.yellow(`path ${++count}: `), `${method} ${apiUrl}`, colors.blue(typeof fileObject[method]));
        app[method](apiUrl, function (req, res) {
          res.json(fileObject[method]);
        });
      });
      continue;
    }

    // 非js文件跳过
    if (!el.name.endsWith('.js')) {
      continue;
    }
    composeRoute(filePath);
  }
};
app.use(crossDomain());
if (process.env.SPECIFIED_FILE) {
  composeRoute(process.env.SPECIFIED_FILE);
} else {
  parseMockFiles(process.env.SPECIFIED_DIR);
}
log.info(chalk.hex('#ce5b34bd')(`${fileCount} mock file are parsed in total.`));
const http = require('http').createServer(app);
if (process.env.SOCKETSERVER) {
  socketServer = new Server(http, { path: '/ws/mock-service' });
  log.info(colors.bgBlue(`Socket server has started. path: /ws/mock-service, `));
  socketServer.of('/mock-data').on('connection', function (socket) {
    const { headers, address } = socket.handshake;
    const clientIp = headers.hasOwnProperty('x-forwarded-for') ? headers['x-forwarded-for'] : address;
    log.info(colors.green(`Socket client ${clientIp} has connected.`));
    socket.on('mock-dir-stat', function (dir) {
      socket.emit('mock-dir-stat', getMockStatFromDir(dir));
    });
    socket.on('mock-file-stat', function (filePath) {
      socket.emit('mock-file-stat', getMockStatFromFile(filePath));
    });
    socket.on('save-data', function (data) {
      // console.log('lis save-data:', data);
      genMockFiles(data);
    });

    socket.on('disconnect', function () {
      log.info(colors.gray(`Socket client ${clientIp} has disconnected.`));
    });
  });
}

http.listen(Number.parseInt(process.env.PORT, 10), () => {
  console.info(
    [
      colors.yellow(`\n${process.env.RESTARTED ? 'Restarting' : 'Starting'} up mock-server, serving `),
      colors.cyan(process.env.SPECIFIED_FILE || process.env.SPECIFIED_DIR),
      colors.yellow(`  ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
    ].join('')
  );
  if (!process.env.RESTARTED) {
    console.info(
      [colors.yellow('\n🌍  mock-server version: '), colors.cyan(require('../package.json').version), '\n'].join('')
    );

    Object.keys(ifaces).forEach(function (dev) {
      ifaces[dev].forEach(function (details) {
        if (details.family === 'IPv4') {
          console.info('    http://' + details.address + ':' + colors.green(process.env.PORT));
        }
      });
    });
  }
});

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
  log.info(colors.red('mock-server process stopped.'));
  process.exit();
});

process.on('SIGTERM', function () {
  log.info(colors.red('mock-server process stopped.'));
  process.exit();
});

module.exports = {
  composeRoute,
  parseMockFiles
};
