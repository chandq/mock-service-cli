/*
 * @description: 工具函数库
 * @Date: 2021-12-25 17:52:48
 * @LastEditors: chendq
 * @LastEditTime: 2021-12-31 22:13:41
 * @Author: chendq
 */
const fs = require('fs');
/**
 * @description: 输出和错误输出写入不同文件
 * @param {*}
 * @return {*}
 */
const path = require('path');
const getLogger = function () {
  const options = {
    flags: 'a', // append模式
    encoding: 'utf8' // utf8编码
  };
  const output = fs.createWriteStream('./stdout.log', options);
  const errorOutput = fs.createWriteStream('./stderr.log', options);
  // 自定义日志打印
  const logger = new console.Console(output, errorOutput);

  // logger.log('向 stdout 中写入数据');
  // logger.error('向 stderr 中写入数据');

  return {
    log: (...args) => logger.log.call(null, `[${dateFormat('YYYY-mm-dd HH:MM:SS:fff')}]  - `, ...args),
    error: (...args) => logger.error.call(null, `[${dateFormat('YYYY-mm-dd HH:MM:SS:fff')}]  - `, ...args)
  };
};
/**
 * @description: 格式化时间日期
 * @param {*} fmt
 * @param {*} date
 * @returns {*}
 */
function dateFormat(fmt, date = new Date()) {
  let ret;
  const opt = {
    'Y+': date.getFullYear().toString(), // 年
    'm+': (date.getMonth() + 1).toString(), // 月
    'd+': date.getDate().toString(), // 日
    'H+': date.getHours().toString(), // 时
    'M+': date.getMinutes().toString(), // 分
    'S+': date.getSeconds().toString(), // 秒
    'f+': date.getMilliseconds().toString() // 毫秒
    // 有其他格式化字符需求可以继续添加，必须转化成字符串
  };
  // eslint-disable-next-line guard-for-in
  for (const k in opt) {
    ret = new RegExp('(' + k + ')').exec(fmt);
    if (ret) {
      fmt = fmt.replace(ret[1], ret[1].length === 1 ? opt[k] : opt[k].padStart(ret[1].length, '0'));
    }
  }
  return fmt;
}
/**
 * @description: 控制是否写日志
 * @param {*} isSilent
 * @return {*}
 */
function logger(isSilent = false) {
  let logObj = null;
  if (!isSilent) {
    logObj = {
      info: console.log,
      assert: console.assert
    };
  } else {
    logObj = {
      info: function () {},
      assert: function () {}
    };
  }
  return logObj;
}
// MockServer 支持的请求类型
const SupportMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS', 'COPY', 'LINK', 'UNLINK', 'PURGE'];

const isValidMethod = function (m) {
  return SupportMethods.includes(String(m).toLocaleUpperCase());
};

/**
 * @description: 获取文件最新内容
 * @param {string} filePath 文件路径
 * @return {object} 文件内容
 */
const getFileLatestContent = function (filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(path.resolve(process.cwd(), filePath));
};
/**
 * @description: 文件路径转成API的url
 * @param {string} filePath
 * @return {string} apiUrl
 */
const filePath2ApiUrl = function (filePath) {
  return filePath.split(path.sep).join('/');
};
/**
 * @description: 获取数据类型
 * @param {any} data 数据值
 * @return {string} 数据类型
 */
const getDataType = function (data) {
  return Object.prototype.toString.call(data).slice(8, -1).toLowerCase();
};
/**
 * @description: 流方式写文件（适合写超大文件）
 * @param {string} filePath
 * @param {object} data
 * @return {*}
 */
const writeStream = function (filePath, data) {
  // 创建一个可写流   也会创建一个test1.txt文件
  const writerStream = fs.createWriteStream(filePath);
  // 将数据写入流
  writerStream.write(data, 'utf-8');
  // 标记文件的结束
  writerStream.end();
  writerStream.on('finish', () => {
    // console.log('写入完成');
  });
  writerStream.on('error', () => {
    console.error(`${filePath} 写入失败`);
  });
};
/**
 * @description: 流方式读文件（适合写超大文件）
 * @param {string} filePath
 * @return {*}
 */
const readeStream = function (filePath) {
  let data = '';
  // 创建可读流
  return new Promise((resovle, reject) => {
    const readerStream = fs.createReadStream(filePath);
    // 设置编码为 utf8。
    readerStream.setEncoding('UTF8');
    // 处理流事件 --> data, end, and error
    readerStream.on('data', function (chunk) {
      data += chunk;
    });
    readerStream.on('end', function () {
      resovle(data);
    });
    readerStream.on('error', function (err) {
      reject(err);
      console.log(err.stack);
    });
  });
};

module.exports = {
  getLogger,
  dateFormat,
  logger,
  SupportMethods,
  isValidMethod,
  getFileLatestContent,
  filePath2ApiUrl,
  getDataType,
  writeStream,
  readeStream
};
