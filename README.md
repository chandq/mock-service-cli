[![Build Status](https://travis-ci.org/chandq/mock-service-cli.svg?branch=master)](https://travis-ci.org/chandq/mock-service-cli)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/npm/v/mock-service-cli.svg)](https://www.npmjs.com/package/mock-service-cli)
[![license:MIT](https://img.shields.io/npm/l/vue.svg?sanitize=true)](https://www.npmjs.com/package/mock-service-cli#license)
[![Downloads:?](https://img.shields.io/npm/dm/mock-service-cli.svg?sanitize=true)](https://npmcharts.com/compare/mock-service-cli?minimal=true)

# mock-service-cli： 🦅 一个基于 node 和 express 的 本地 Mock Server 命令行工具

### 简介

简单、零配置的命令行 Mock 服务器， 支持热更新，对于前端开发调试很实用，能提高前端开发者的开发效率。

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
  '/mock/:id/test': { aa: 1, bb: '西西小飞龙' },
  '/mock/video/test': (req, res) => {
    res.json({ aa: 1, bb: 'asdf' });
  },
  '/mock/image/test': (req, res) => {
    res.json({ aa: 1, bb: 'yyds' });
  }
};
```
