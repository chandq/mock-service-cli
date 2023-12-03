/*
 * Static Server
 * @Date: 2023-12-03 18:02:24
 * @LastEditors: chendq
 * @LastEditTime: 2023-12-03 18:44:33
 * @Author      : chendq
 */
const express = require('express'), // 引入express
  os = require('os'),
  colors = require('colors/safe'),
  portfinder = require('portfinder');
const { dateFormat, logger } = require('./utils');
const ifaces = os.networkInterfaces();
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
const app = express();

app.use(express.static(process.env.STATIC_DIRECTORY)); // 将dist目录下所有文件作为静态文件来管理

app.listen(Number.parseInt(process.env.PORT, 10), () => {
  console.info(
    [
      colors.yellow(`\nStarting up Static Server, serving `),
      colors.cyan(process.env.STATIC_DIRECTORY),
      colors.yellow(`  ${dateFormat('YYYY-mm-dd HH:MM:SS', new Date())}`)
    ].join('')
  );

  console.info(colors.yellow(`\n Static Server available on:\n`));
  console.info('    http://localhost:' + colors.green(process.env.PORT));
  Object.keys(ifaces).forEach(function (dev) {
    ifaces[dev].forEach(function (details) {
      if (details.family === 'IPv4') {
        console.info('    http://' + details.address + ':' + colors.green(process.env.PORT));
      }
    });
  });
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
