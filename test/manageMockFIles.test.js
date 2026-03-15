/*
 * @description: Mock数据统计test unit
 * @Date: 2021-12-23 17:10:26
 * @LastEditors: chendq
 * @LastEditTime: 2026-03-15 17:30:25
 * @Author: chendq
 */
const test = require('tap').test;
const path = require('path');
const { genMockFiles, getMockStatFromDir, getMockStatFromFile, hasMockApi } = require('../lib/manageMockFiles');

test('run genMockFiles function - with args', async t => {
  t.plan(1);
  await genMockFiles({
    url: '/api/ops/config/user/desktop/getMenuList',
    method: 'get',
    data: {
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
    dir: path.resolve(__dirname, '../mock')
  });
  await genMockFiles({
    url: '/api/ops/config/user/desktop/getMenuList',
    method: 'post',
    data: {
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
        }
      ]
    },
    dir: path.resolve(__dirname, '../mock')
  });
  await genMockFiles({
    url: '/api/yyds',
    method: 'get',
    data: { type: 'get' },
    dir: path.resolve(__dirname, '../mock')
  });
  await genMockFiles({
    url: '/api/yyds',
    method: 'post',
    data: { type: 'post' },
    dir: path.resolve(__dirname, '../mock')
  });
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
  hasMockApi(mockStat, '/api/ops/config/user/desktop/getMenuList', 'get');
  t.pass('ok');
  t.end();
});

test('run hasMockApi function - invalid parameters', t => {
  t.plan(4);

  t.equal(hasMockApi(null, '/api/test', 'get'), undefined, 'should handle null mockDataMap');
  t.equal(hasMockApi({}, '', 'get'), undefined, 'should handle empty apiUrl');
  t.equal(hasMockApi({}, '/api/test', ''), undefined, 'should handle empty method');
  t.equal(hasMockApi('not-object', '/api/test', 'get'), undefined, 'should handle non-object mockDataMap');
  t.end();
});

test('run hasMockApi function - valid and invalid APIs', t => {
  t.plan(2);

  const mockStat = getMockStatFromDir(path.resolve(__dirname, '../mock'));
  const exists = hasMockApi(mockStat, '/api/ops/config/user/desktop/getMenuList', 'get');
  const notExists = hasMockApi(mockStat, '/api/this/does/not/exist', 'get');
  t.ok(exists, 'should find existing API');
  t.ok(!notExists, 'should not find non-existing API');
  t.end();
});

test('run getMockStatFromFile function - with different formats', t => {
  t.plan(2);

  const stat1 = getMockStatFromFile(path.resolve(__dirname, '../mock/element-template.js'));
  t.ok(typeof stat1 === 'object', 'should return object for js file');
  t.ok(Object.keys(stat1).length > 0, 'js file should have some APIs');

  t.end();
});
