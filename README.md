[![GitHub Workflow Status (master)](https://img.shields.io/github/workflow/status/chandq/mock-service-cli/Node.js%20CI/master?style=flat-square)](https://github.com/chandq/mock-service-cli/actions)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/github/package-json/v/chandq/mock-service-cli?style=flat-square)](https://github.com/chandq/mock-service-cli)
[![node](https://img.shields.io/badge/node-v14.0.0-blue)](https://nodejs.org/download/release/v14.0.0/)
[![node](https://img.shields.io/badge/language-node-orange.svg)](https://nodejs.org/download/release/v14.0.0/)
[![license:MIT](https://img.shields.io/npm/l/vue.svg?sanitize=true)](https://github.com/chandq/mock-service-cli/blob/master/LICENSE.md)
[![Downloads:?](https://img.shields.io/npm/dm/mock-service-cli.svg?sanitize=true)](https://npmcharts.com/compare/mock-service-cli?minimal=true)

# mock-service-cli： 🦅 一个基于 node 和 express 的 本地 Mock Server 命令行工具

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

     mock-service-cli [path] [options]

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

### mock file template

> e.g. `./mock/test.js`

```javascript
module.exports = {
  '/mock/:id/test': { aa: 1, bb: '默认GET请求' },
  'GET /mock/:id/test': { aa: 1, bb: '指定GET 方法' },
  'POST /mock/:id/test': { aa: 1, bb: 'POST 方法' },
  'DELETE /mock/:id/test': { aa: 1, bb: 'DELETE 方法' },
  'PUT /mock/:id/test': { aa: 1, bb: 'PUT 方法' },
  'PATCH /mock/:id/test': { aa: 1, bb: 'PATCH 方法' },
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
  }
};
```
