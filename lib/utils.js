/**
 * @description: 输出和错误输出写入不同文件
 * @param {*}
 * @return {*}
 */
const getLogger = function () {
  const fs = require('fs');
  const output = fs.createWriteStream('./stdout.log');
  const errorOutput = fs.createWriteStream('./stderr.log');
  // 自定义日志打印
  const logger = new console.Console(output, errorOutput);

  logger.log('向 stdout 中写入数据');
  logger.error('向 stderr 中写入数据');

  return logger;
};
/**
 * @description: 格式化时间日期
 * @param {*} fmt
 * @param {*} date
 * @returns {*}
 */
function dateFormat(fmt, date) {
  let ret;
  const opt = {
    'Y+': date.getFullYear().toString(), // 年
    'm+': (date.getMonth() + 1).toString(), // 月
    'd+': date.getDate().toString(), // 日
    'H+': date.getHours().toString(), // 时
    'M+': date.getMinutes().toString(), // 分
    'S+': date.getSeconds().toString() // 秒
    // 有其他格式化字符需求可以继续添加，必须转化成字符串
  };
  for (const k in opt) {
    ret = new RegExp('(' + k + ')').exec(fmt);
    if (ret) {
      fmt = fmt.replace(ret[1], ret[1].length === 1 ? opt[k] : opt[k].padStart(ret[1].length, '0'));
    }
  }
  return fmt;
}

module.exports = { getLogger, dateFormat };
