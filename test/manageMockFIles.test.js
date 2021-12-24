/*
 * @description: Mock数据统计test unit
 * @Date: 2021-12-23 17:10:26
 * @LastEditors: chendq
 * @LastEditTime: 2021-12-23 20:35:10
 * @Author: chendq
 */
const test = require('tap').test;
const path = require('path');
const { genMockFiles, getMockStatFromDir, getMockStatFromFile, hasMockApi } = require('../lib/manageMockFiles');

test('run genMockFiles function - with args', t => {
  t.plan(1);

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
    path.resolve(__dirname, '../mock')
  );
  t.pass('ok');
  t.end();
});

test('run getMockStatFromDir function - with args', t => {
  t.plan(1);

  getMockStatFromDir(path.resolve(__dirname, '../mock'));
  t.pass('ok');
  t.end();
});
test('run getMockStatFromFile function - with args', t => {
  t.plan(1);

  getMockStatFromFile(path.resolve(__dirname, '../mock/element-template.js'));
  t.pass('ok');
  t.end();
});
test('run hasMockApi function - with args', t => {
  t.plan(1);

  const mockStat = getMockStatFromDir(path.resolve(__dirname, '../mock'));
  hasMockApi(mockStat, '/mock/api/test', 'get');
  t.pass('ok');
  t.end();
});
