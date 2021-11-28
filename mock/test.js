/*
 * @description:
 * @Date: 2021-10-26 10:06:45
 * @LastEditors: chendq
 * @LastEditTime: 2021-11-28 13:35:05
 * @Author: chendq
 */
const Mock = require('mockjs');

module.exports = {
  '/mock/api/test1': { aa: 1, bb: '默认GET请求' },
  'GET /mock/api/test': { aa: 1, bb: '指定GET 方法' },
  'POST /mock/api/test': { aa: 1, bb: 'POST 方法' },
  'DELETE /mock/api/test': { aa: 1, bb: 'DELETE 方法' },
  'PUT /mock/api/test': { aa: 1, bb: 'PUT 方法' },
  'PATCH /mock/api/test': { aa: 1, bb: 'PATCH 方法' },
  'HEAD /mock/api/test': { aa: 1, bb: 'HEAD 方法' },
  'OPTIONS /mock/api/test': { aa: 1, bb: 'OPTIONS 方法' },
  'COPY /mock/api/test': { aa: 1, bb: 'COPY 方法' },
  'LINK /mock/api/test': { aa: 1, bb: 'LINK 方法' },
  'UNLINK /mock/api/test': { aa: 1, bb: 'UNLINK 方法' },
  'PURGE /mock/api/test': { aa: 1, bb: 'PURGE 方法' },

  // 支持自定义函数，API 参考 express@4
  '/mock/video/test': (req, res) => {
    // 添加特定请求头token
    res.header('token', '5848778333359208');
    res.json({ aa: 1, bb: 'asdfg' });
  },
  '/mock/image/test': (req, res) => {
    res.json({ aa: 1, bb: 'yyds' });
  },
  '/mock/api/random/cn': (req, res) => {
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
