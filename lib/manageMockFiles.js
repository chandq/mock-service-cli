/*
 * @description: 生成Mock文件、获取mock数据统计
 * @Date: 2021-12-22 16:57:08
 * @LastEditors: chendq
 * @LastEditTime: 2022-01-06 13:41:12
 * @Author: chendq
 */
const fsa = require('fs-extra'),
  fs = require('fs'),
  path = require('path'),
  _ = require('lodash'),
  colors = require('colors/safe');
const {
  getFileLatestContent,
  SupportMethods,
  filePath2ApiUrl,
  logger,
  getDataType,
  getLogger,
  writeStream
} = require('./utils');
const log = logger(process.env.SILENT);
const processArgv = process.env.ARGV ? JSON.parse(process.env.ARGV) : {};

const methodRegExp = new RegExp(`(${SupportMethods.join('|')}) +(.*)`, 'i');
/**
 * @description: 记录日志文件函数
 * @param {boolean} isWriteLogFile 是否写入日志文件
 * @param {string} mockDir 存放日志文件的目录
 * @return {object}
 */
const logFile = (isWriteLogFile = false, mockDir) => {
  if (isWriteLogFile) {
    return getLogger(mockDir);
  }
  return {
    log: function () {},
    error: function () {}
  };
};
/**
 * @description: 生成mock文件（自动生成mock-list.json文件，并维护<url, [method]>的关系映射）
 * @param {string} apiUrl 请求url
 * @param {string} method 请求方法
 * @param {object} resJsonData 响应数据
 * @param {string} mockDir mock目录
 * @return {*} void
 *
 */
const genMockFiles = async function ({ url: apiUrl, method, data: resJsonData, dir: mockDir }) {
  const type = getDataType(resJsonData);
  if (!apiUrl || !method || !resJsonData || !mockDir) {
    log.info(
      colors.red([`参数: apiUrl: ${apiUrl}, method: ${method}, mockDir: ${mockDir} `, `必须是有效值`].join(','))
    );
    return;
  } else if (
    !['object', 'array'].includes(type) ||
    (type === 'object' && Object.keys(resJsonData).length === 0) ||
    (type === 'array' && resJsonData.length === 0)
  ) {
    log.info(
      `参数: apiUrl: ${apiUrl}, method: ${method}, resJsonData:`,
      resJsonData,
      colors.red('， 参数字段resJsonData必须是非空的数组或对象！')
    );
    return;
  }
  apiUrl = apiUrl.trim().split('?')[0];
  const LOGGER = logFile(processArgv.l || processArgv.log, mockDir);
  const normalizeApiUrl = filePath2ApiUrl(path.normalize(apiUrl));
  const mockListFilePath = path.resolve(process.cwd(), `${mockDir}/mock-list.json`);
  const mockFilePath = path.resolve(process.cwd(), `${mockDir}/${encodeURIComponent(path.normalize(apiUrl))}.json`);
  let newMockListContent = {};
  if (fsa.pathExistsSync(mockListFilePath)) {
    newMockListContent = getFileLatestContent(mockListFilePath);
  } else {
    fsa.ensureFileSync(mockListFilePath);
  }

  let isChange = false;
  // update mock-list.json file
  if (!newMockListContent.hasOwnProperty(normalizeApiUrl)) {
    newMockListContent[normalizeApiUrl] = [method];
    isChange = true;
  } else if (!newMockListContent[normalizeApiUrl].includes(method)) {
    newMockListContent[normalizeApiUrl].push(method);
    isChange = true;
  }
  if (isChange) {
    Object.keys(newMockListContent).length > 0 &&
      fs.writeFileSync(mockListFilePath, JSON.stringify(newMockListContent, null, 2));
  }

  // mock文件存在
  if (fsa.pathExistsSync(mockFilePath)) {
    const mockFileContent = getFileLatestContent(mockFilePath);
    // 内容一样不作修改
    if (mockFileContent.hasOwnProperty(method) && _.isEqual(mockFileContent[method], resJsonData)) {
      // log.assert(
      //   !_.isEqual(mockFileContent[method], resJsonData),
      //   colors.bgYellow(`${method} ${apiUrl}, Mock data is same`)
      // );
      return;
    }
    mockFileContent[method] = resJsonData;
    try {
      await writeStream(mockFilePath, JSON.stringify(mockFileContent, null, 2));
    } catch (error) {
      LOGGER.error(`Update file:  ${method} ${apiUrl}  ${mockFilePath}`);
    }
    LOGGER.log(`Update file:  ${method} ${apiUrl}  ${mockFilePath}`);
  } else {
    try {
      await writeStream(mockFilePath, JSON.stringify({ [method]: resJsonData }, null, 2));
    } catch (error) {
      LOGGER.error(`New    file:  ${method} ${apiUrl}  ${mockFilePath}`);
    }
    LOGGER.log(`New    file:  ${method} ${apiUrl}  ${mockFilePath}`);
  }
  // console.debug('file::', `${mockDir}/${apiUrl}`, newMockListContent);
};
/**
 * @description: 从js文件中收集mock数据
 * @param {object} mockDataMap
 * @param {string} filePath
 * @return {*} void
 */
const collectMockDataFromJsFile = function (mockDataMap, filePath) {
  // 先删除require之前导入的缓存文件,否则获取到的文件内容还是旧内容
  const fileObject = getFileLatestContent(filePath);

  Object.keys(fileObject).forEach(item => {
    let reqMethod = 'get',
      reqUrl = item;
    if (methodRegExp.exec(item)) {
      const [, method, url] = methodRegExp.exec(item);
      reqMethod = method.toLowerCase();
      reqUrl = path.normalize(url);
    }
    if (typeof fileObject[item] === 'function') {
      mockDataMap[`${reqMethod} ${reqUrl}`] = String(fileObject[item]);
    } else if (typeof fileObject[item] === 'object') {
      mockDataMap[`${reqMethod} ${reqUrl}`] = fileObject[item];
    }
  });
};

/**
 * @description: 递归收集mock数据
 * @param {object} mockDataMap mock数据集
 * @param {string} specialDir 目录
 * @return {*} void
 */
const deepCollectMockData = function (mockDataMap, specialDir = '../mock') {
  const files = fs.readdirSync(path.resolve(process.cwd(), specialDir), { withFileTypes: true });
  const curFilesSize = files.length;
  for (let index = 0; index < curFilesSize; index++) {
    const el = files[index];
    const filePath = path.normalize(`${specialDir}/${el.name}`);
    // 递归目录
    if (!el.isFile()) {
      deepCollectMockData(mockDataMap, filePath);
    }

    // 处理存放mock数据的json文件
    if (el.name.endsWith('.json') && el.name !== 'mock-list.json') {
      const fileObject = getFileLatestContent(filePath);
      Object.keys(fileObject).forEach(method => {
        mockDataMap[`${method.toLocaleLowerCase()} ${decodeURIComponent(el.name).split('.json')[0]}`] =
          fileObject[method];
      });
      continue;
    }

    // 非js文件跳过
    if (!el.name.endsWith('.js')) {
      continue;
    }
    collectMockDataFromJsFile(mockDataMap, filePath);
  }
};
/**
 * @description: 从文件目录中获取mock数据统计（若mock-list.json文件不存在则自动生成）
 * @param {string} dirPath
 * @return {object} mock数据统计
 */
const getMockStatFromDir = dirPath => {
  if (!fsa.pathExistsSync(dirPath)) {
    getLogger(path.resolve(process.cwd())).error(`入参无效，${dirPath} 目录不存在`);
    return;
  }
  const mockDataMap = {};
  deepCollectMockData(mockDataMap, dirPath);

  const mockListFilePath = path.resolve(process.cwd(), `${dirPath}/mock-list.json`);
  // 若不存在mock-list.json文件，则根据现有mock文件重新生成<api, [method]>映射关系
  if (Object.keys(mockDataMap).length > 0 && !fsa.pathExistsSync(mockListFilePath)) {
    fsa.ensureFileSync(mockListFilePath);
    const reverseMockList = {};
    Object.keys(mockDataMap).forEach(it => {
      if (methodRegExp.exec(it)) {
        const [, method, url] = methodRegExp.exec(it);
        if (url.trim() && method.trim()) {
          if (reverseMockList.hasOwnProperty(url)) {
            reverseMockList[url].push(method);
          } else {
            reverseMockList[url] = [method];
          }
        }
      }
    });
    writeStream(mockListFilePath, JSON.stringify(reverseMockList, null, 2));
  }
  return mockDataMap;
};

/**
 * @description: 从js文件中获取mock数据统计
 * @param {string} filePath
 * @return {object}  mock数据统计
 */
const getMockStatFromFile = filePath => {
  if (!fsa.pathExistsSync(filePath)) {
    getLogger(path.resolve(process.cwd())).error(`入参无效，${filePath} 文件不存在`);
    return;
  }
  const mockDataMap = {};
  collectMockDataFromJsFile(mockDataMap, filePath);
  return mockDataMap;
};
/**
 * @description: 判断Mock服务中是否存在某个API
 * @param {object} mockDataMap
 * @param {string} apiUrl
 * @param {string} method
 * @return {boolean}
 */
const hasMockApi = function (mockDataMap, apiUrl, method) {
  if (!apiUrl || !method || !mockDataMap || !(mockDataMap instanceof Object)) {
    getLogger(path.resolve(process.cwd())).error(`入参无效，${mockDataMap} 必须是 mock数据的Object对象`);
    return;
  }
  return mockDataMap.hasOwnProperty(`${method.toLocaleLowerCase()} ${path.normalize(apiUrl)}`);
};

module.exports = {
  genMockFiles,
  getMockStatFromDir,
  getMockStatFromFile,
  hasMockApi
};
