/*
 * @description: 生成Mock文件、获取mock数据统计
 * @Date: 2021-12-22 16:57:08
 * @LastEditors: chendq
 * @LastEditTime: 2021-12-23 20:49:56
 * @Author: chendq
 */
const fsa = require('fs-extra'),
  fs = require('fs'),
  path = require('path'),
  _ = require('lodash'),
  colors = require('colors/safe');
const { getFileLatestContent, SupportMethods } = require('./utils');

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
const genMockFiles = function (apiUrl, method, resJsonData, mockDir) {
  const normalizeUrl = path.normalize(apiUrl);
  const mockListFilePath = path.resolve(process.cwd(), `${mockDir}/mock-list.json`);
  const mockFilePath = path.resolve(process.cwd(), `${mockDir}/${encodeURIComponent(normalizeUrl)}.json`);
  let mockApiMap = {};
  if (fsa.pathExistsSync(mockListFilePath)) {
    mockApiMap = getFileLatestContent(mockListFilePath);
  } else {
    fsa.ensureFileSync(mockListFilePath);
  }

  // mock文件存在
  if (fsa.pathExistsSync(mockFilePath)) {
    delete require.cache[require.resolve(mockFilePath)];
    const oldFile = require(mockFilePath);
    // 内容一样不作修改
    if (oldFile.hasOwnProperty(method) && _.isEqual(oldFile[method], resJsonData)) {
      console.assert(!_.isEqual(oldFile[method], resJsonData), colors.bgYellow('Mock data is same'));
      return;
    }
    oldFile[method] = resJsonData ? resJsonData : {};

    if (!mockApiMap.hasOwnProperty(normalizeUrl)) {
      mockApiMap[normalizeUrl] = [method];
    } else if (!mockApiMap[normalizeUrl].includes(method)) {
      mockApiMap[normalizeUrl].push(method);
    }
    fsa.writeFile(mockFilePath, JSON.stringify(oldFile, null, 2));
  } else {
    if (!mockApiMap.hasOwnProperty(normalizeUrl)) {
      mockApiMap[normalizeUrl] = [method];
    } else if (!mockApiMap[normalizeUrl].includes(method)) {
      mockApiMap[normalizeUrl].push(method);
    }
    // fsa.ensureFileSync(mockFilePath);
    fsa.writeFile(mockFilePath, JSON.stringify({ [method]: resJsonData ? resJsonData : {} }, null, 2));
  }
  fsa.writeFile(mockListFilePath, JSON.stringify(mockApiMap, null, 2));
  console.log('file::', `${mockDir}/${normalizeUrl}`, mockApiMap);
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
      mockDataMap.set(`${reqMethod} ${reqUrl}`, String(fileObject[item]));
    } else if (typeof fileObject[item] === 'object') {
      mockDataMap.set(`${reqMethod} ${reqUrl}`, fileObject[item]);
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
  const files = fs.readdirSync(path.resolve(__dirname, specialDir), { withFileTypes: true });
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
        mockDataMap.set(`${method.toLocaleLowerCase()} ${decodeURIComponent(el.name)}`, fileObject[method]);
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
  const mockDataMap = new Map();
  deepCollectMockData(mockDataMap, dirPath);
  return mockDataMap;
};

/**
 * @description: 从js文件中获取mock数据统计
 * @param {string} filePath
 * @return {map}  mock数据统计
 */
const getMockStatFromFile = filePath => {
  const mockDataMap = new Map();
  collectMockDataFromJsFile(mockDataMap, filePath);
  return mockDataMap;
};
/**
 * @description: 判断Mock服务中是否存在某个API
 * @param {map} mockDataMap
 * @param {string} apiUrl
 * @param {string} method
 * @return {boolean}
 */
const hasMockApi = function (mockDataMap, apiUrl, method) {
  if (!mockDataMap || !(mockDataMap instanceof Map)) {
    throw new Error(`如参无效，${mockDataMap} 必须是 mock数据的Map对象`);
  }
  return mockDataMap.has(`${method.toLocaleLowerCase()} ${path.normalize(apiUrl)}`);
};

genMockFiles(
  '/api/ops/config/user/desktop/getMenuList',
  'get',
  {
    code: '200',
    message: 'success',
    data: [
      {
        id: 194,
        code: '6788',
        version: '2.0.0',
        name: '6788222',
        redirectUrl: '/api/device/dm/twin/6788/',
        type: 6,
        secondType: 5,
        status: 1,
        inMenu: 1,
        createTime: '2021-11-24 10:59:56',
        surName: '6'
      },
      {
        id: 34,
        code: 'apix',
        version: '1.0.0',
        name: 'APIX研发平台',
        logo: '/desktop/icon/default.png',
        type: 0,
        secondType: 2,
        status: 1,
        inMenu: 1,
        createTime: '2021-06-08 12:09:45',
        updateTime: '2021-11-25 16:15:00',
        surName: 'A'
      }
    ]
  },
  './mock'
);

module.exports = {
  genMockFiles,
  getMockStatFromDir,
  getMockStatFromFile,
  hasMockApi
};