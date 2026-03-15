[![Node.js CI](https://github.com/chandq/mock-service-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/chandq/mock-service-cli/actions/workflows/node.js.yml)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/github/package-json/v/chandq/mock-service-cli?style=flat-square)](https://www.npmjs.com/package/mock-service-cli)
[![node](https://img.shields.io/badge/language-node-orange.svg)](https://nodejs.org/download/release/v12.0.0/)
[![license:MIT](https://img.shields.io/npm/l/vue.svg?sanitize=true)](https://github.com/chandq/mock-service-cli/blob/master/LICENSE.md)

# 🦅 mock-service-cli

一个基于 Node.js 和 Express 的轻量级 Mock 套件命令行工具，提供本地开发调试所需的各种服务器功能。

## ✨ 核心功能

- **Mock Server** - 本地 Mock 服务器，支持热更新和多种请求方法
- **Static Server** - 静态资源服务器
- **SPA Server** - 单页应用服务器（模拟生产环境）
- **HTTP Proxy** - 本地接口代理服务
- **API Overview** - 现代化的 API 概览页面
- **File Explorer** - 现代化的文件浏览器

## 🚀 特性

- 📊 支持统计 mock 文件数量和请求数量
- 🔧 支持终端打开 mock 文件所在位置
- 🎨 自动生成和打开现代化的 API 概览页面
- 🌐 支持跨域配置
- 🔄 支持热更新（Mock 文件改动后自动重启）
- 📁 支持文件浏览器，可预览各种文件类型
- 💾 支持保存接口响应数据
- 🔗 支持 HTTP 请求代理

## 📦 安装

### 全局安装

```bash
npm install --global mock-service-cli
# 或
brew install mock-service-cli
```

### 局部安装

```bash
npm install mock-service-cli --save-dev
```

### 直接运行

```bash
npx mock-service-cli [options] [path]
```

## 🛠️ 命令行选项

| 选项                       | 描述                                                        | 默认值 |
| -------------------------- | ----------------------------------------------------------- | ------ |
| `-h` 或 `--help`           | 显示帮助信息                                                | -      |
| `-p` 或 `--port`           | Mock 服务器端口                                             | 8090   |
| `-d`                       | 指定 mock 目录                                              | ./mock |
| `-f`                       | 指定单个 mock 文件                                          | -      |
| `-s` 或 `--silent`         | 抑制日志输出                                                | -      |
| `-v` 或 `--version`        | 显示版本信息                                                | -      |
| `-S` 或 `--socket-server`  | 启动 socket 服务器，用于保存 API 响应数据                   | false  |
| `-a` 或 `--api-stat`       | 打印 API URL 和文件路径信息                                 | false  |
| `-t` 或 `--track`          | 记录操作信息到文件                                          | false  |
| `-o` 或 `--cors-origin`    | 配置 CORS 允许的源，多个源用逗号分隔                        | \*     |
| `-O` 或 `--proxy-options`  | 配置 HTTP 请求代理选项，支持 js 文件、json 文件或命令行参数 | -      |
| `-H` 或 `--cors-headers`   | 配置 CORS 头信息                                            | \*     |
| `-A` 或 `--append-headers` | 添加响应头信息，多个头用逗号分隔                            | -      |
| `-D` 或 `--web-dir`        | 启用 Web 服务器，指定 web 目录（SPA 应用）                  | -      |
| `-P` 或 `--web-port`       | Web 服务器端口                                              | 9090   |
| `-b` 或 `--web-baseurl`    | 指定 SPA Web 服务器的公共路径                               | -      |
| `-R` 或 `--static-server`  | 启用静态服务器，指定静态资源目录                            | -      |
| `-w` 或 `--open`           | 自动打开 API 概览页面                                       | false  |
| `-e` 或 `--explorer`       | 启用文件浏览器服务器，指定要浏览的目录                      | ./     |

## 📖 使用示例

### Mock 服务器

```bash
# 使用默认配置启动 Mock 服务器
mock-service-cli

# 指定端口和目录
mock-service-cli -p 8080 -d ./api

# 自动打开 API 概览页面
mock-service-cli --open

# 使用单个 Mock 文件
mock-service-cli -f ./mock.js
```

### 静态服务器

```bash
# 启动静态服务器
mock-service-cli -R ./public
```

### Web 服务器 (SPA)

```bash
# 启动 SPA 服务器
mock-service-cli -D ./dist

# 指定公共路径和端口
mock-service-cli -D ./dist -b /app -P 9090
```

### HTTP 代理

```bash
# 启动带代理的 Web 服务器
mock-service-cli -D ./ -O '/api|http://localhost:3000'

# 使用代理配置文件
mock-service-cli -D ./ -O ./proxy.js
```

### 文件浏览器

```bash
# 浏览当前目录
mock-service-cli -e ./

# 浏览指定目录
mock-service-cli -e /path/to/directory

# 指定端口
mock-service-cli -e ./ -p 9090
```

## 📝 编写 Mock 文件

Mock 文件支持 CommonJS 规范，不支持 ES Module。

```javascript
// mock/test.js
module.exports = {
  // GET 可忽略
  '/mock/api/test': { aa: 1, bb: '默认GET请求' },
  'GET /mock/api/:id/test': { aa: 1, bb: '使用id占位符' },
  'POST /mock/api/test': { aa: 1, bb: 'POST 方法' },
  'DELETE /mock/api/test': { aa: 1, bb: 'DELETE 方法' },
  // 支持自定义函数
  '/mock/api/video/test': (req, res) => {
    res.header('token', '5848778333359208');
    res.json({ aa: 1, bb: 'asdf' });
  }
};
```

### 引入 Mock.js

可以使用 [Mock.js](http://mockjs.com/) 生成模拟数据：

```javascript
const mockjs = require('mockjs');

module.exports = {
  'GET /api/tags': mockjs.mock({
    'list|100': [
      {
        'NO|+1': 1,
        city: '@city',
        'value|1-100': 50
      }
    ]
  })
};
```

## 🎨 API 概览页面

现代化的 Web 界面，用于展示和测试所有已注册的 Mock API 接口。

### 功能特性

- 📁 按目录分类展示 API
- 🔍 支持搜索接口
- 🎯 每种 HTTP 方法使用不同颜色标签
- 🧪 支持直接在页面中测试 API
- 📋 响应数据格式化展示

### 访问方式

- **自动打开**：使用 `--open` 参数
- **手动访问**：`http://localhost:8090/__api-overview`

## 📁 文件浏览器

现代化的文件浏览界面，支持目录导航、文件预览和管理。

### 功能特性

- 📁 **目录导航**：面包屑导航，支持快速跳转
- 👁️ **文件预览**：
  - 图片文件：直接预览（JPG、PNG、GIF、WebP 等）
  - 文本文件：代码高亮预览（JS、JSON、HTML、CSS 等）
  - 其他文件：提供下载
- 🎨 **图标标识**：不同文件类型使用不同颜色图标
- 📱 **视图切换**：网格视图和列表视图
- ⚡ **操作功能**：
  - 在系统文件管理器中打开
  - 复制文件路径
  - 下载文件
  - 刷新目录
  - 显示/隐藏隐藏文件
- 🔍 **搜索**：支持文件名模糊搜索
- 📊 **排序**：按名称、时间、大小排序
- ⌨️ **键盘快捷键**：
  - `Escape`：关闭预览
  - `Backspace`：返回上级

### 界面预览

- 渐变紫色现代化设计
- 响应式布局
- 流畅的交互体验

## 🔧 高级功能

### 保存接口响应数据

使用 Socket.io 保存接口响应数据，用于后续 Mock：

```javascript
import { io } from 'socket.io-client';

const socket = io.connect('http://localhost:8090/mock-data', {
  transports: ['websocket'],
  path: '/ws/mock-service'
});

// 保存接口数据
socket.emit('save-data', { url, method, data, dir });

// 获取目录统计信息
socket.emit('mock-dir-stat', dirPath);
socket.on('mock-dir-stat', data => {
  console.log('统计信息:', data);
});
```

## 📚 文档

- [GitHub 仓库](https://github.com/chandq/mock-service-cli)
- [npm 包](https://www.npmjs.com/package/mock-service-cli)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 详见 [LICENSE.md](LICENSE.md)
