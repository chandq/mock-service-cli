const express = require('express'), // 引入express
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  colors = require('colors/safe'),
  portfinder = require('portfinder');
const { createProxyMiddleware } = require('http-proxy-middleware');
const ifaces = os.networkInterfaces();
const { Server } = require('socket.io');
const {
  dateFormat,
  logger,
  SupportMethods,
  DefaultHeaders,
  getFileLatestContent,
  filePath2ApiUrl,
  isEmptyObj
} = require('./utils');
const { genMockFiles, getMockStatFromDir, getMockStatFromFile } = require('./manageMockFiles');

const methodRegExp = new RegExp(`(${SupportMethods.join('|')}) +(.*)`, 'i');

const app = express();
const log = logger(process.env.SILENT);
const argv = JSON.parse(process.env.ARGV);
let socketServer = null; // Socket server instance
const AsyncTaskQueue = require('./asyncTaskQueue');
const saveDataAsyncTask = new AsyncTaskQueue();

let count = 0,
  fileCount = 0, // 记录mock api个数,mock file个数
  mockDirStat = {}, // 缓存mock目录的统计信息
  mockFileStat = {}; // 缓存mock文件的统计信息
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
let corsOrigin = [],
  corsHeaders = '';
if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(/\s*,\s*/).forEach(function (h) {
    corsOrigin.push(h);
  }, this);

  corsHeaders = DefaultHeaders;
}
if (process.env.CORS_HEADERS) {
  process.env.CORS_HEADERS.split(/\s*,\s*/).forEach(function (h) {
    corsHeaders += corsHeaders ? ', ' + h : h;
  }, this);
}
/**
 * @description: 跨域设置
 * @param {*}
 * @return {*}
 */
const crossDomain = () => (req, res, next) => {
  // 设置withCredentials: true时,需设置以下两项
  res.header('Access-Control-Allow-Credentials', true);
  // withCredentials, must be specified value instead of *
  res.header('Access-Control-Allow-Origin', corsOrigin.includes(req.headers.origin) ? req.headers.origin : '*');
  // res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', SupportMethods.join(','));
  res.header('Access-Control-Allow-Headers', corsHeaders ? corsHeaders : '*');
  // res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') res.status(200); // 让OPTIONS快速返回
  next();
};

/**
 * @description: 构建本地服务的路由请求
 * @param {*} file
 * @returns {*}
 */
const composeRouteFromJsFile = function (file) {
  // 先删除require之前导入的缓存文件,否则获取到的文件内容还是旧内容
  const fileObject = getFileLatestContent(file);

  argv.a && log.info(colors.green(`Mockfile ${++fileCount}: `), file, colors.yellow('all API URL is follows: '));
  Object.keys(fileObject).forEach(item => {
    let reqMethod = 'get',
      reqUrl = item;
    // 支持(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS|COPY|LINK|UNLINK|PURGE)常用方法, 默认GET请求
    if (methodRegExp.exec(item)) {
      const [, method, url] = methodRegExp.exec(item);
      reqMethod = method.toLowerCase();
      reqUrl = url;
    }
    argv.a && log.info(colors.yellow(`path ${++count}: `), item, colors.blue(typeof fileObject[item]));
    log.assert(typeof app[reqMethod] === 'function', colors.red(`${file}, ${reqMethod}`));
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
  const files = fs.readdirSync(path.resolve(process.cwd(), specialDir), { withFileTypes: true });
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
      argv.a &&
        log.info(colors.green(`Mockfile ${++fileCount}: `), filePath, colors.yellow('all API URL is follows: '));
      const fileObject = getFileLatestContent(filePath);
      // eslint-disable-next-line no-loop-func
      Object.keys(fileObject).forEach(method => {
        const apiUrl = filePath2ApiUrl(decodeURIComponent(el.name.split('.')[0]));
        argv.a &&
          log.info(colors.yellow(`path ${++count}: `), `${method} ${apiUrl}`, colors.blue(typeof fileObject[method]));
        log.assert(typeof app[method] === 'function', colors.red(`${filePath}, ${method}`));
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
    composeRouteFromJsFile(filePath);
  }
};

// 允许跨域
app.use(crossDomain());

if (process.env.SPECIFIED_FILE) {
  composeRouteFromJsFile(process.env.SPECIFIED_FILE);
} else {
  parseMockFiles(process.env.SPECIFIED_DIR);
}
argv.a && log.info(colors.yellow(`${fileCount} mock file are parsed in total.`));

let webApp = null,
  webPublicPath = '/',
  proxyTable = {};
// Enable Web Server
if (process.env.WEB_ROOT) {
  webApp = express();
  // Enable web proxy
  if (process.env.PROXY_OPTIONS) {
    try {
      const options = JSON.parse(process.env.PROXY_OPTIONS);
      Object.keys(options).forEach(function (origin) {
        proxyTable[origin] = options[origin];
        // 接口代理
        webApp.use(origin, createProxyMiddleware({ target: options[origin], changeOrigin: true, ws: true }));
      }, this);
    } catch (error) {
      console.warn(colors.yellow('\nEnable web proxy Failed:', error));
    }
  }
  // console.log(process.env.WEB_PUBLIC_PATH, process.env.WEB_ROOT);
  if (process.env.WEB_PUBLIC_PATH) {
    webPublicPath = process.env.WEB_PUBLIC_PATH;
  }
  webApp.use(webPublicPath, express.static(process.env.WEB_ROOT)); // 将dist目录下所有文件作为静态文件来管理
  const defaultStaticEntry = `${process.env.WEB_ROOT}/index.html`;
  if (fs.existsSync(defaultStaticEntry)) {
    webApp.get('*', (req, res) => {
      res.sendFile(defaultStaticEntry);
    });
  } else {
    webApp.use(webPublicPath, (req, res) => {
      res.status(200)
        .send(`Hi, welcome to web server entrance ui, you can test http proxy on browser console or api request tools. Examples as follows:<br />
        fetch("http://localhost:${process.env.WEB_PORT}/api/permission/auth/login", {
          method: 'post',
          headers: {
            "accept": "*/*",
            "Content-type": "application/json; charset=UTF-8",
          },
          body:JSON.stringify({"loginName":"admin","password":"admin"})
        })
      `);
    });
  }
}
const http = require('http').createServer(app);
if (process.env.SOCKET_SERVER) {
  socketServer = new Server(http, { path: '/ws/mock-service' });
  log.info(colors.bgBlue(`Socket server has started. path: /ws/mock-service, `));
  socketServer.of('/mock-data').on('connection', function (socket) {
    const { headers, address } = socket.handshake;
    const clientIp = headers.hasOwnProperty('x-forwarded-for') ? headers['x-forwarded-for'] : address;
    log.info(
      colors.green(`Socket client ${clientIp} has connected.     --- ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
    );
    socket.on('mock-dir-stat', function (dir) {
      socket.emit('mock-dir-stat', isEmptyObj(mockDirStat) ? (mockDirStat = getMockStatFromDir(dir)) : mockDirStat);
    });
    socket.on('mock-file-stat', function (filePath) {
      socket.emit(
        'mock-file-stat',
        isEmptyObj(mockFileStat) ? (mockFileStat = getMockStatFromFile(filePath)) : mockFileStat
      );
    });
    const async = args => {
      return async next => {
        await genMockFiles(args);
        next();
      };
    };
    socket.on('save-data', function (data) {
      // console.log('lis save-data:', data);
      saveDataAsyncTask.add(async(data));

      if (saveDataAsyncTask.list.length === 1) {
        saveDataAsyncTask.run();
      } else {
        saveDataAsyncTask.next();
      }
      // await genMockFiles(data);
    });

    socket.on('disconnect', function () {
      log.info(
        colors.gray(
          `Socket client ${clientIp} has disconnected.     --- ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`
        )
      );
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
    console.info(colors.yellow(`\n Mock server available on:\n`));
    console.info('    http://localhost:' + colors.green(process.env.PORT));
    Object.keys(ifaces).forEach(function (dev) {
      ifaces[dev].forEach(function (details) {
        if (details.family === 'IPv4') {
          console.info('    http://' + details.address + ':' + colors.green(process.env.PORT));
        }
      });
    });
  }
});

if (webApp && !process.env.RESTARTED) {
  webApp.listen(Number.parseInt(process.env.WEB_PORT, 10), () => {
    console.info(colors.yellow(`\n Web server available on:\n`));
    console.info('    http://localhost:' + colors.green(process.env.WEB_PORT) + webPublicPath);
    Object.keys(ifaces).forEach(function (dev) {
      ifaces[dev].forEach(function (details) {
        if (details.family === 'IPv4') {
          console.info('    http://' + details.address + ':' + colors.green(process.env.WEB_PORT) + webPublicPath);
        }
      });
    });
    if (!isEmptyObj(proxyTable)) {
      console.info(colors.yellow(`\n Enable proxy at web server on:`));
      Object.keys(proxyTable).forEach(origin => {
        console.info(`    ${origin}   ->  ${proxyTable[origin]}`);
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
  log.info(colors.red('mock-server process stopped.'));
  process.exit();
});

process.on('SIGTERM', function () {
  log.info(colors.red('mock-server process stopped.'));
  process.exit();
});

module.exports = {
  composeRouteFromJsFile,
  parseMockFiles
};
