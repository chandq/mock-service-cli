const express = require('express'), // 引入express
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  colors = require('colors/safe'),
  portfinder = require('portfinder'),
  chalk = require('chalk');
const ifaces = os.networkInterfaces();
const { dateFormat, logger } = require('./utils');

const app = express();
const log = logger(process.env.SILENT);
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
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
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
  delete require.cache[require.resolve(file)];
  const fileObject = require(path.resolve(__dirname, file));

  log.info(colors.bgGreen('Mockfile: '), file);
  Object.keys(fileObject).forEach(item => {
    log.info(colors.bgYellow('Traversal url: '), item, colors.blue(typeof fileObject[item]));
    if (typeof fileObject[item] === 'function') {
      app.use(item, fileObject[item]);
    } else if (typeof fileObject[item] === 'object') {
      app.use(item, function (req, res) {
        res.json(fileObject[item]);
      });
    }
  });
};
/**
 * @description: 解析mock目录下的js文件，为构建路由请求做准备
 * @param {*}
 * @return {*}
 */
const parseMockFiles = function (specialDir = '../mock') {
  const files = fs.readdirSync(path.resolve(__dirname, specialDir), { withFileTypes: true });
  for (let index = 0; index < files.length; index++) {
    const el = files[index];
    // 过滤目录
    if (!el.isFile() || !el.name.endsWith('.js')) {
      continue;
    }
    composeRoute(`${specialDir}/${el.name}`);
  }

  log.info(chalk.hex('#ce5b34bd')(`${files.length} mock file parsed`));
};
app.use(crossDomain());

if (process.env.SPECIFIED_FILE) {
  composeRoute(process.env.SPECIFIED_FILE);
} else {
  parseMockFiles(process.env.SPECIFIED_DIR);
}

app.listen(Number.parseInt(process.env.PORT, 10), () => {
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
