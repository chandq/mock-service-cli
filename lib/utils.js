/*
 * @description: 工具函数库
 * @Date: 2021-12-25 17:52:48
 * @LastEditors: chendq
 * @LastEditTime: 2022-01-05 20:21:07
 * @Author: chendq
 */
const fs = require('fs');
const path = require('path');
// const JSONStream = require('JSONStream');
/**
 * @description: 输出和错误输出写入不同文件
 * @param {string} logFileDirPath
 * @return {object}
 */
const getLogger = function (logFileDirPath) {
  const options = {
    flags: 'a', // append模式
    encoding: 'utf8' // utf8编码
  };
  const output = fs.createWriteStream(
    path.resolve(logFileDirPath ? logFileDirPath : path.resolve(process.cwd()), './stdout.log'),
    options
  );
  const errorOutput = fs.createWriteStream(
    path.resolve(logFileDirPath ? logFileDirPath : path.resolve(process.cwd()), './stderr.log'),
    options
  );
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
 * @param {string} fmt 时间日期字符串格式化模板
 * @param {date} date 时间日期Date
 * @returns {string}
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
 * @param {boolean} isSilent 是否静默
 * @return {object}
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
const DefaultHeaders =
  'Authorization,Content-Type,Accept,Origin,User-Agent,DNT,Cache-Control,X-Mx-ReqToken,X-Data-Type,X-Requested-With,X-Data-Type,X-Auth-Token,Token';
const isValidMethod = function (m) {
  return SupportMethods.includes(String(m).toLocaleUpperCase());
};

/**
 * @description: 获取文件最新内容
 * @param {string} filePath 文件路径
 * @return {object} 文件内容
 */
const getFileLatestContent = function (filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    return require(path.resolve(process.cwd(), filePath));
  } catch (error) {
    getLogger(path.resolve(process.cwd())).error(filePath, require.cache[require.resolve(filePath)], error);
  }
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
 * @description: 判断对象是否为空
 * @param {object} obj
 * @return {boolean}
 */
const isEmptyObj = function (obj) {
  return getDataType(obj) === 'object' && Object.keys(obj).length === 0;
};
/**
 * @description: 流方式写文件（适合写超大文件）
 * @param {string} filePath
 * @param {object} data
 * @return {promise}
 */
const writeStream = function (filePath, data) {
  // 创建一个可写流   也会创建一个test1.txt文件
  return new Promise((resolve, reject) => {
    const writerStream = fs.createWriteStream(filePath);
    // 将数据写入流
    writerStream.write(data, 'utf-8');
    // 标记文件的结束
    writerStream.end();
    writerStream.on('finish', () => {});
    writerStream.on('close', () => {
      setTimeout(() => {
        resolve(data);
      });
    });

    writerStream.on('error', err => {
      getLogger(path.resolve(process.cwd())).error(filePath, require.cache[require.resolve(filePath)], err);
      reject(err);
    });
  });
};
/**
 * @description: 流方式读文件（适合写超大文件）
 * @param {string} filePath
 * @return {*}
 */
const readStream = function (filePath) {
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

/**
 * 防抖函数
 * 当函数被连续调用时，该函数并不执行，只有当其全部停止调用超过一定时间后才执行1次。
 * 例如：上电梯的时候，大家陆陆续续进来，电梯的门不会关上，只有当一段时间都没有人上来，电梯才会关门。
 * @param {F} func
 * @param {number} wait
 * @returns {DebounceFunc<F>}
 */
const debounce = (func, wait) => {
  let timeout;
  let canceled = false;
  const f = function (...args) {
    if (canceled) return;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.call(this, ...args);
    }, wait);
  };
  f.cancel = () => {
    clearTimeout(timeout);
    canceled = true;
  };
  return f;
};
/**
 * 节流函数
 * 节流就是节约流量，将连续触发的事件稀释成预设评率。 比如每间隔1秒执行一次函数，无论这期间触发多少次事件。
 * 这有点像公交车，无论在站点等车的人多不多，公交车只会按时来一班，不会来一个人就来一辆公交车。
 * @param {F} func
 * @param {number} wait
 * @param {boolean} immediate
 * @returns {ThrottleFunc<F>}
 */
const throttle = (func, wait, immediate) => {
  let timeout;
  let canceled = false;
  let lastCalledTime = 0;
  const f = function (...args) {
    if (canceled) return;
    const now = Date.now();
    const call = () => {
      lastCalledTime = now;
      func.call(this, ...args);
    };
    // 第一次执行
    if (lastCalledTime === 0) {
      if (immediate) {
        return call();
      }

      lastCalledTime = now;
      return;
    }
    const remain = lastCalledTime + wait - now;
    if (remain > 0) {
      clearTimeout(timeout);
      timeout = setTimeout(() => call(), wait);
    } else {
      call();
    }
  };
  f.cancel = () => {
    clearTimeout(timeout);
    canceled = true;
  };
  return f;
};
// /**
//  * @description: 带模糊搜索的分块读取大JSON文件
//  * @param {string} filePath
//  * @return {*}
//  */
// const readBigJson = function (filePath) {
//   return new Promise((resolve, reject) => {
//     let res = '';
//     const readable = fs.createReadStream(filePath, {
//       encoding: 'utf8',
//       highWaterMark: 10
//     });
//     const parser = JSONStream.parse('*');
//     readable.pipe(parser);
//     parser.on('end', function () {
//       // I know it ends here,
//       console.log('end::', res);
//       resolve(res);
//     });
//     parser.on('data', function (data) {
//       res += data;
//       console.log('yy::', data);
//     });
//   });
// };

module.exports = {
  getLogger,
  dateFormat,
  logger,
  SupportMethods,
  DefaultHeaders,
  isValidMethod,
  getFileLatestContent,
  filePath2ApiUrl,
  getDataType,
  isEmptyObj,
  writeStream,
  readStream,
  debounce,
  throttle
};
