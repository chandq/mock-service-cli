/*
 * @description: 生成Mock文件、获取mock数据统计
 * @Date: 2021-12-22 16:57:08
 * @LastEditors: chendq
 * @LastEditTime: 2021-12-27 10:15:01
 * @Author: chendq
 */
const fsa = require('fs-extra'),
  fs = require('fs'),
  path = require('path'),
  _ = require('lodash'),
  colors = require('colors/safe');
const { getFileLatestContent, SupportMethods, logger } = require('./utils');
const log = logger(process.env.SILENT);

const methodRegExp = new RegExp(`(${SupportMethods.join('|')}) +(.*)`, 'i');
/**
 * @description: 生成mock文件
 * @param {string} apiUrl 请求url
 * @param {string} method 请求方法
 * @param {object} resJsonData 响应数据
 * @param {string} mockDir mock目录
 * @return {*} void
 *
 */
const genMockFiles = function ({ url: apiUrl, method, data: resJsonData, dir: mockDir }) {
  const normalizeUrl = path.normalize(apiUrl);
  const mockListFilePath = path.resolve(process.cwd(), `${mockDir}/mock-list.json`);
  const mockFilePath = path.resolve(process.cwd(), `${mockDir}/${encodeURIComponent(normalizeUrl)}.json`);
  let newMockListContent = {},
    oldMockListContent = null;
  if (fsa.pathExistsSync(mockListFilePath)) {
    oldMockListContent = getFileLatestContent(mockListFilePath);
    newMockListContent = _.cloneDeep(oldMockListContent);
  } else {
    fsa.ensureFileSync(mockListFilePath);
  }

  // update mock-list.json file
  if (!newMockListContent.hasOwnProperty(normalizeUrl)) {
    newMockListContent[normalizeUrl] = [method];
  } else if (!newMockListContent[normalizeUrl].includes(method)) {
    newMockListContent[normalizeUrl].push(method);
  }
  if (!oldMockListContent || !_.isEqual(oldMockListContent, newMockListContent)) {
    fsa.writeFileSync(mockListFilePath, JSON.stringify(newMockListContent, null, 2));
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
    mockFileContent[method] = resJsonData ? resJsonData : {};
    fsa.writeFileSync(mockFilePath, JSON.stringify(mockFileContent, null, 2));
  } else {
    // fsa.ensureFileSync(mockFilePath);
    fsa.writeFileSync(mockFilePath, JSON.stringify({ [method]: resJsonData ? resJsonData : {} }, null, 2));
  }
  // console.debug('file::', `${mockDir}/${normalizeUrl}`, newMockListContent);
};
/**
 * @description: 从js文件中收集mock数据
 * @param {map} mockDataMap
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
 * @param {map} mockDataMap mock数据集
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
 * @description: 从文件目录中获取mock数据统计
 * @param {string} dirPath
 * @return {map} mock数据统计
 */
const getMockStatFromDir = dirPath => {
  const mockDataMap = {};
  deepCollectMockData(mockDataMap, dirPath);
  return mockDataMap;
};

/**
 * @description: 从js文件中获取mock数据统计
 * @param {string} filePath
 * @return {map}  mock数据统计
 */
const getMockStatFromFile = filePath => {
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
  if (!mockDataMap || !(mockDataMap instanceof Object)) {
    throw new Error(`如参无效，${mockDataMap} 必须是 mock数据的Object对象`);
  }
  return mockDataMap.hasOwnProperty(`${method.toLocaleLowerCase()} ${path.normalize(apiUrl)}`);
};

module.exports = {
  genMockFiles,
  getMockStatFromDir,
  getMockStatFromFile,
  hasMockApi
};
