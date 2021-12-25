[![GitHub Workflow Status (master)](https://img.shields.io/github/workflow/status/chandq/mock-service-cli/Node.js%20CI/master?style=flat-square)](https://github.com/chandq/mock-service-cli/actions)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/github/package-json/v/chandq/mock-service-cli?style=flat-square)](https://github.com/chandq/mock-service-cli)
[![node](https://img.shields.io/badge/node-v14.0.0-blue)](https://nodejs.org/download/release/v14.0.0/)
[![node](https://img.shields.io/badge/language-node-orange.svg)](https://nodejs.org/download/release/v14.0.0/)
[![license:MIT](https://img.shields.io/npm/l/vue.svg?sanitize=true)](https://github.com/chandq/mock-service-cli/blob/master/LICENSE.md)
[![Downloads:?](https://img.shields.io/npm/dm/mock-service-cli.svg?sanitize=true)](https://npmcharts.com/compare/mock-service-cli?minimal=true)

# 🦅 一个基于 [node](https://nodejs.org/en/) 和 [express](https://www.expressjs.com.cn/) 的 本地 Mock Server 命令行工具

### 简介

**使用简单**、**零配置**、**0 秒启动**的本地命令行 Mock 服务器， 支持热更新，对于开发调试 mock 数据很实用，能提高前端开发者的开发效率。支持 `GET`,`POST`,`PUT`,`DELETE`,`PATCH`,`OPTIONS`,`COPY`,`LINK`,`UNLINK`,`PURGE` 等常用请求类型，对工程代码无任何侵入性，可能是本地最好用的 Mock 工具。

## Installation:

#### Running on-demand:

Using `npx` you can run the script without installing it first:

    npx mock-service-cli [path] [options]

#### Globally via `npm`

    npm install --global mock-service-cli

This will install `mock-service-cli` globally so that it may be run from the command line anywhere.

#### Globally via Homebrew

    brew install mock-service-cli

#### As a dependency in your `npm` package:

    npm install mock-service-cli

## Usage:

     mock-service-cli [options] [path]

`[path]` defaults to `./mock` .

| Command             | Description                                                                                                    | Defaults |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| `-p` or `--port`    | Port to use. Use `-p 0` to look for an open port, starting at 8090. It will also read from `process.env.PORT`. | 8090     |
| `-d`                | Specify mock directory                                                                                         | ./mock   |
| `-f`                | Specify mock file                                                                                              |          |
| `-s` or `--silent`  | Suppress log messages from output                                                                              |          |
| `-h` or `--help`    | Print this list and exit.                                                                                      |          |
| `-v` or `--version` | Print the version and exit.                                                                                    |          |

## Example

1. Specify server port.

`mock-service-cli -p 8085`

2. Specify mock directory.

`mock-service-cli -d ./mock`

3. Specify mock file.

`mock-service-cli -f ./mock/test.js`

### 编写 Mock 文件

> mock 请求的类型支持`GET`,`POST`,`PUT`,`DELETE`,`PATCH`,`OPTIONS`,`COPY`,`LINK`,`UNLINK`,`PURGE`

如果 `./mock/test.js` 的内容如下，

```javascript
module.exports = {
  // GET 可忽略
  '/mock/mock/api/test': { aa: 1, bb: '默认GET请求' },
  'GET /mock/api/:id/test': { aa: 1, bb: '使用id占位符' },
  'GET /mock/api/test1': { aa: 1, bb: '指定GET 方法' },
  'POST /mock/api/test': { aa: 1, bb: 'POST 方法' },
  'DELETE /mock/api/test': { aa: 1, bb: 'DELETE 方法' },
  'PUT /mock/api/test': { aa: 1, bb: 'PUT 方法' },
  'PATCH /mock/api/test': { aa: 1, bb: 'PATCH 方法' },
  'OPTIONS /mock/api/test': { aa: 1, bb: 'OPTIONS 方法' },
  'COPY /mock/api/test': { aa: 1, bb: 'COPY 方法' },
  'LINK /mock/api/test': { aa: 1, bb: 'LINK 方法' },
  'UNLINK /mock/api/test': { aa: 1, bb: 'UNLINK 方法' },
  'PURGE /mock/api/test': { aa: 1, bb: 'PURGE 方法' },
  // 支持自定义函数，API 参考 express@4
  '/mock/api/video/test': (req, res) => {
    // 添加特定请求头token
    res.header('token', '5848778333359208');
    res.json({ aa: 1, bb: 'asdf' });
  }
};
```

然后访问 `本地代理地址` + `/mock/api/222/test` （例如`http://127.0.0.1:8090/mock/api/222/test`） 就能得到 { aa: 1, bb: '使用 id 占位符' } 的响应，其他以此类推。

### 引入 Mock.js

[Mock.js](http://mockjs.com/) 是常用的辅助生成模拟数据的三方库，借助他可以提升我们的 mock 数据能力。

比如：

```js
const mockjs = require('mockjs');

module.exports = {
  // 使用 mockjs 等三方库
  'GET /api/tags': mockjs.mock({
    'list|100': [{ name: '@city', 'value|1-100': 50, 'type|0-2': 1 }]
  })
};
```

### 借助 socket.io 保留接口数据

```js
import { io } from 'socket.io-client';

const socket = io.connect('http://{MockServerIP}:{PORT}/write-mock-data', {
  transports: ['websocket'],
  path: '/ws/mock-service'
});

socket.emit('save-data', { url, method, data, dir });
```

在 axios.js 文件中完成所有接口请求响应数据的保存操作, 示例如下：

```js
import { io } from 'socket.io-client';
import axios from 'axios';

const socket = io.connect('http://192.168.31.54:8090/write-mock-data', {
  transports: ['websocket'],
  path: '/ws/mock-service',
  query: {
    token: 'yyds'
  }
});

axios.interceptors.response.use(res => {
  const {
    config: { method, url },
    data
  } = res;
  socket.emit('save-data', { url, method, data, dir: '/home/chen/projects/model-ui/mock' });
  return res;
});
```
