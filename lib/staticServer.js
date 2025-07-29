/*
 * Static Server
 * @Date: 2023-12-03 18:02:24
 * @LastEditors: chendq
 * @LastEditTime: 2025-07-29 16:44:33
 * @Author      : chendq
 */
const express = require('express'), // 引入express
  os = require('os'),
  colors = require('colors/safe'),
  portfinder = require('portfinder');
const { dateFormat, logger } = require('./utils');
const ifaces = os.networkInterfaces();
const log = logger(process.env.SILENT);

const corsHeaders = {};

if (!process.env.PORT) {
  portfinder.basePort = 8090;
  portfinder.getPort(function (err, port) {
    if (err) {
      throw err;
    }
    process.env.PORT = port;
    startServer();
  });
} else {
  startServer();
}

/**
 * @description: 跨域设置
 * @param {*}
 * @return {*}
 */
function crossDomain() {
  return (req, res, next) => {
    for (const key in corsHeaders) {
      if (corsHeaders.hasOwnProperty(key)) {
        res.header(key, corsHeaders[key]);
      }
    }
    next();
  };
}

/**
 * Start server
 */
function startServer() {
  const app = express();

  if (process.env.CORS_HEADERS) {
    process.env.CORS_HEADERS.split(/\s*,\s*/).forEach(function (h) {
      const [key, value] = h.split('=');
      corsHeaders[key] = value;
    }, this);
    app.use(crossDomain()); // 允许跨域
  }

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
