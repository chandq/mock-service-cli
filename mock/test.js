/*
 * @description:
 * @Date: 2021-10-26 10:06:45
 * @LastEditors: chendq
 * @LastEditTime: 2021-11-27 23:39:42
 * @Author: chendq
 */
const Mock = require('mockjs');

module.exports = {
  '/mock/:id/test': { aa: 1, bb: '默认GET请求' },
  'GET /mock/:id/test': { aa: 1, bb: '指定GET 方法' },
  'POST /mock/:id/test': { aa: 1, bb: 'POST 方法' },
  'DELETE /mock/:id/test': { aa: 1, bb: 'DELETE 方法' },
  'PUT /mock/:id/test': { aa: 1, bb: 'PUT 方法' },
  'PATCH /mock/:id/test': { aa: 1, bb: 'PATCH 方法' },
  'HEAD /mock/:id/test': { aa: 1, bb: 'HEAD 方法' },
  'OPTIONS /mock/:id/test': { aa: 1, bb: 'OPTIONS 方法' },
  'COPY /mock/:id/test': { aa: 1, bb: 'COPY 方法' },
  'LINK /mock/:id/test': { aa: 1, bb: 'LINK 方法' },
  'UNLINK /mock/:id/test': { aa: 1, bb: 'UNLINK 方法' },
  'PURGE /mock/:id/test': { aa: 1, bb: 'PURGE 方法' },
  '/mock/video/test': (req, res) => {
    res.json({ aa: 1, bb: 'asdf' });
  },
  '/mock/image/test': (req, res) => {
    res.json({ aa: 1, bb: 'yyds' });
  },
  '/mock/api/cjx/random/cn': (req, res) => {
    res.json(
      Mock.mock({
        status: 200,
        'dataSource|1-9': [
          {
            'key|+1': 1,
            'mockTitle|1': ['肆无忌惮'],
            'mockContent|1': [
              '角色精湛主题略荒诞',
              '理由太短 是让人不安',
              '疑信参半 却无比期盼',
              '你的惯犯 圆满',
              '别让纠缠 显得 孤单'
            ],
            'mockAction|1': ['下载', '试听', '喜欢']
          }
        ]
      })
    );
  }
};
