[![Node.js CI](https://github.com/chandq/mock-service-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/chandq/mock-service-cli/actions/workflows/node.js.yml)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/github/package-json/v/chandq/mock-service-cli?style=flat-square)](https://www.npmjs.com/package/mock-service-cli)
[![node](https://img.shields.io/badge/language-node-orange.svg)](https://nodejs.org/download/release/v12.0.0/)
[![license:MIT](https://img.shields.io/npm/l/vue.svg?sanitize=true)](https://github.com/chandq/mock-service-cli/blob/master/LICENSE.md)

<!-- [![Downloads:?](https://img.shields.io/npm/dm/mock-service-cli.svg?sanitize=true)](https://npmcharts.com/compare/mock-service-cli?minimal=true) -->

# 🦅 一个基于 [node](https://nodejs.org/en/) 和 [express](https://www.expressjs.com.cn/) 的 轻量级 Mock 套件 命令行工具

### 简介

内置 **Static Server**、**Mock Server**、**SPA Server**、Http?s request proxy、API overview page 等功能集。

**简易轻量**、**B/S 架构**、**0 秒启动**的本地命令行 Mock 服务套件， 支持热更新，对于开发调试 mock 数据很实用，能提高前端开发者的开发效率。支持 `GET`,`POST`,`PUT`,`DELETE`,`PATCH`,`OPTIONS`,`COPY`,`LINK`,`UNLINK`,`PURGE` 等常用请求类型，无需布署后端，可能是本地最好用的 Mock 工具之一。

特性功能：

- 支持统计 mock 的文件数量和 mock 请求数量
- 支持终端打开 mock 文件的所在位置
- 支持自动生成和打开现代化的 API 概览页面（按目录分类、可折叠展开、可点击测试 API）

#### Static Server (和 Mock Server 互斥使用)

简易的静态资源服务器，可用于开发调试，如需更多使用场景，请选择 [http-server](https://www.npmjs.com/package/http-server)

#### Mock Server - 本地 Mock 服务器

**支持热更新，即 Mock 文件改动后自动重启服务**

> Mock File 仅支持 commonjs 规范的 js、cjs 文件，不支持 ES Module

支持以下常见业务场景：

- [x] 无服务端演示项目的数据 Mock
- [x] 业务开发接口联调前的数据 Mock
- [x] 保留业务项目的所有或部分接口的响应数据(写入文件)
- [x] 保障前端开发调试不受后端服务影响(当后端服务挂掉或部分接口响应异常时启用 Mock)

#### Web Server - SPA Web 服务器

对 React、Vue 等单页应用项目构建生成的 dist 目录，启动本地 web 服务器（相当于使用本地安装的 nginx 服务）来模拟运行生产环境下的 web 服务

#### Http request proxy - 基于浏览器的本地代理服务

实现了本地接口代理的能力，一般接口测试工具无法查看到 request 和 response 中 headers 的更多详情，这里实现了接口代理功能，在 Network 中可查看接口调用的详细信息。

> 两种应用场景

- 项目 dev 模式下的接口代理请求
- Chrome 的 Console 执行 fetch 请求（用于接口测试）

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

| Command                    | Description                                                                                                                                                                                                                                                                                                          | Defaults |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `-h` or `--help`           | Print this list and exit.                                                                                                                                                                                                                                                                                            |          |
| `-p` or `--port`           | Mock server port to use. Use `-p 8090` to look for an open port, starting at 8090.                                                                                                                                                                                                                                   | 8090     |
| `-d`                       | Specify mock directory                                                                                                                                                                                                                                                                                               | ./mock   |
| `-f`                       | Specify mock file                                                                                                                                                                                                                                                                                                    |          |
| `-s` or `--silent`         | Suppress log messages from output                                                                                                                                                                                                                                                                                    |          |
| `-v` or `--version`        | Print the version and exit.                                                                                                                                                                                                                                                                                          |          |
| `-S` or `--socket-server`  | Start socket server which used to save api response data for future mock.                                                                                                                                                                                                                                            | false    |
| `-a` or `--api-stat`       | Whether print api url and file path info or not, default false.                                                                                                                                                                                                                                                      | false    |
| `-t` or `--track`          | Whether record operation info by write file, default false.                                                                                                                                                                                                                                                          | false    |
| `-o` or `--cors-origin`    | Allow origin by cors, list separated by commas, must not be \* when withCredential is true .If specified, cors-headers will be `Authorization,Content-Type,Accept,Origin,User-Agent,DNT,Cache-Control,X-Mx-ReqToken,X-Data-Type,X-Requested-With,X-Data-Type,X-Auth-Token,Token`                                     | \*       |
| `-O` or `--proxy-options`  | Optionally provide http request proxy options list, support accept js file、json file、cli arguments string. Examples: `-O '/api/apaas\|http://192.168.0.105:60700,/api/permission\| http://192.168.0.105:60700'`. Must start web server to use proxy for http request test under browser console or api test tools. | -        |
| `-H` or `--cors-headers`   | When start Mock Server, optionally provide CORS headers list separated by commas. default .                                                                                                                                                                                                                          | \*       |
| `-A` or `--append-headers` | When start Mock/Web/Static Server, optionally add response headers list separated by commas. For example: X-Frame-options=DENY,content-security-policy=frame-ancestors.                                                                                                                                              | -        |
| `-P` or `--web-port`       | Web server port to use. Use `-P 9090` to look for an open port, starting at 9090.                                                                                                                                                                                                                                    | 9090     |
| `-b` or `--web-baseurl`    | Specify public path of the SPA web server, can be base address of SPA route.                                                                                                                                                                                                                                         | -        |
| `-R` or `--static-server`  | Specify directory of the Static Web Server.                                                                                                                                                                                                                                                                          | -        |
| `-w` or `--open`           | Open API overview page automatically.                                                                                                                                                                                                                                                                                | false    |
| `-e` or `--explorer`       | Enable file explorer server, specify directory to browse, default [./].                                                                                                                                                                                                                                              | ./       |

## Example

1. Specify static resource file directory to startup Static Server.

`mock-service-cli -R ./test`

2. Specify mock server port.

`mock-service-cli -p 8085`

3. Enable cors of mock server, specify the origin and headers of http request.

`mock-service-cli -o "http://192.168.0.8:38200,http://10.30.30.3" -H "custom-header"`

4. Specify mock directory to startup Mock Server.

`mock-service-cli -d ./mock`

5. Specify mock file to startup Mock Server.

`mock-service-cli -f ./mock/test.js`

6. Start socket server for used to save api response data.

`mock-service-cli -S`

7. Only Used as api server for test on browser console or api request tools.
   > must specified server directory which can be empty but not includes index.html file, and also need config API proxy.

`mock-service-cli -D server -O '/api/apaas|http://192.168.0.105:60700'`

8. Start static web server for SPA, and optionally specify public path and port.

`mock-service-cli -D ../react-best-practice/dist [-b '/redbridge/'] [-P 9090]`

9. Enable Proxy base on above item 7. support accept js file、json file、cli arguments string

   - cli arguments string

     `mock-service-cli -D ./ -O '/api/apaas|http://192.168.0.105:60700,/api/permission|http://192.168.0.105:60700'`

   - js file

   `mock-service-cli -D ./ -O ./proxy.js`

   proxy.js file content as follows:

```js
module.exports = {
  '/api/apaas': 'http://192.168.0.105:60700',
  '/api/permission': 'http://192.168.0.105:60700'
};
```

10. Start Mock Server and automatically open API overview page.

`mock-service-cli --open`

11. Start Mock Server with custom port and automatically open API overview page.

`mock-service-cli -p 8080 --open`

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

![Mock Server](/assets/mock-server.jpg)

### 引入 Mock.js

[Mock.js](http://mockjs.com/) 是常用的辅助生成模拟数据的三方库，借助他可以提升我们的 mock 数据能力。

比如：

```js
const mockjs = require('mockjs');

module.exports = {
  // 使用 mockjs 等三方库
  'GET /api/tags': mockjs.mock({
    'list|100': [
      {
        'NO|+1': 1,
        city: '@city',
        maintainType: '@cname(3, 5)',
        urgentType: '@cword(3, 5)',
        'isCrash|1': 'true',
        createTime: '@date',
        'value|1-100': 50,
        'type|0-2': 1
      }
    ]
  })
};
```

### 启动 Web Server, 在本地像 nginx 一样运行 dist 文件对应的 SPA

![Web Server](/assets/web-server.jpg)

### 启动 Web Server, 启用 Proxy

![Web Server Proxy](/assets/web-server-proxy.jpg)

### API 概览页面

API 概览页面是一个现代化的 Web 界面，用于展示和测试所有已注册的 Mock API 接口。

#### 功能特性

- 按目录分类展示 API 接口
- 目录可折叠/展开
- 支持按 URL 或 HTTP 方法搜索接口
- 每种 HTTP 方法使用不同颜色的标签（GET、POST、PUT、DELETE 等）
- 点击接口可查看详细信息
- 支持直接在页面中测试 API（发送请求并查看响应）
- 响应数据格式化展示

#### 访问方式

1. **自动打开**：使用 `--open` 参数启动服务时，会自动在浏览器中打开 API 概览页面

   ```bash
   mock-service-cli --open
   ```

2. **手动访问**：在浏览器中访问以下地址
   ```
   http://localhost:8090/__api-overview
   ```

#### 页面预览

API 概览页面采用现代化的响应式设计，包含以下部分：

- 统计卡片：展示总接口数、目录数、各 HTTP 方法数量
- 搜索框：快速查找接口
- 目录列表：按目录分组展示所有接口
- 测试面板：点击接口后可进行测试

### 借助 socket.io 保留接口数据

> `save-data` 和 `mock-dir-stat` 事件会自动生成 `mock-list.json` 文件（维护接口`<url, [method]>`的关系映射），方便查阅接口统计信息

```js
// 连接SocketServer
import { io } from 'socket.io-client';

const socket = io.connect('http://{MockServerIP}:{PORT}/mock-data', {
  transports: ['websocket'],
  path: '/ws/mock-service'
});
// 向SocketServer发消息：保存接口数据
socket.emit('save-data', { url, method, data, dir });
// 向SocketServer发消息：获取指定目录的Mock统计信息
socket.emit('mock-dir-stat', dirPath);
// 监听SocketServer消息：获取指定目录的Mock统计信息
socket.on('mock-dir-stat', function (mockDirStat) {});
// 向SocketServer发消息：获取指定文件的Mock统计信息
socket.emit('mock-file-stat', filePath);
// 监听SocketServer消息：获取指定文件的Mock统计信息
socket.on('mock-file-stat', function (mockFileStat) {});
```

在 axios.js 文件中完成保存所有接口响应数据、根据 Mock 数据池自动 Mock 的操作, 示例如下：

```js
import { io } from 'socket.io-client';
import axios from 'axios';

const socket = io.connect('http://192.168.31.54:8090/mock-data', {
  transports: ['websocket'],
  path: '/ws/mock-service',
  query: {
    token: 'yyds'
  }
});

socket.emit('mock-dir-stat', '/home/chen/projects/model-ui/mock');
socket.on('mock-dir-stat', function (data) {
  console.debug('mock-dir-stat:', data);
});
// 保存所有接口响应数据（也可过滤部分接口）
axios.interceptors.response.use(res => {
  const {
    config: { method, url },
    data
  } = res;
  socket.emit('save-data', { url, method, data, dir: '/home/chen/projects/model-ui/mock' });
  return res;
});
// 根据Mock数据池自动Mock（也可根据实际场景决定是否Mock）
axios.interceptors.request.use(config => {
  if (Object.keys(mockObj).includes(`${config.method} ${config.url}`)) {
    config.baseURL = 'http://localhost:8090';
  }
  return config;
});
```

### 文件浏览器 (File Explorer)

文件浏览器是一个现代化的 Web 界面，用于浏览和预览本地文件和目录，类似于 http-server，但提供了更丰富的交互体验。

#### 功能特性

- **目录导航**：点击目录进入子目录，支持面包屑导航快速跳转
- **文件预览**：
  - 图片文件：直接预览（支持 JPG、PNG、GIF、BMP、WebP、SVG、ICO）
  - 文本文件：代码高亮预览（支持 JS、JSON、HTML、CSS、MD、TXT 等）
  - 其他文件：提供下载链接
- **图标标识**：
  - 不同文件类型使用不同颜色的图标
  - 隐藏文件（以 . 开头）使用半透明效果
- **视图切换**：支持网格视图和列表视图
- **文件信息**：显示文件大小和修改时间
- **键盘快捷键**：
  - `Escape`：关闭预览窗口
  - `Backspace`：返回上级目录

#### 使用方式

```bash
# 浏览当前目录
mock-service-cli -e ./

# 浏览指定目录
mock-service-cli -e /path/to/directory

# 指定端口并浏览
mock-service-cli -e ./ -p 9090
```

启动后，浏览器会自动打开文件浏览器页面（如未自动打开，可手动访问 `http://localhost:8090`）。

#### 界面预览

文件浏览器采用现代化的渐变紫色设计，包含以下部分：

- 面包屑导航：显示当前路径，点击可快速跳转
- 工具栏：返回上级按钮、视图切换按钮
- 文件列表：
  - 网格视图：大图标展示，适合快速浏览
  - 列表视图：详细信息展示，适合管理文件
- 文件预览弹窗：点击文件后打开，支持图片和文本预览
