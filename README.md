[![release status](https://github.com/chandq/mock-service-cli/actions/workflows/release.yml/badge.svg)](https://github.com/chandq/mock-service-cli/actions/workflows/release.yml)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/github/package-json/v/chandq/mock-service-cli?style=flat-square)](https://www.npmjs.com/package/mock-service-cli)
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
# npm
npm install --global mock-service-cli

# Homebrew (macOS / Linux)
brew tap chandq/tap
brew install mock-service-cli

# Scoop (Windows)
scoop bucket add chandq https://github.com/chandq/scoop-bucket
scoop install mock-service-cli

# Nix (Linux / macOS)
nix run github:chandq/mock-service-cli -- --help     # 临时运行
nix profile install github:chandq/mock-service-cli     # 安装到 profile
```

需要 RAR、7z、bzip2、xz 等高级归档格式时，安装 Ultra 版。它与轻量版使用相同的命令，不能同时全局安装：

```bash
npm install --global mock-service-cli-ultra
# Homebrew / Scoop 对应 Ultra 包名：mock-service-cli-ultra
brew tap chandq/tap && brew install mock-service-cli-ultra
scoop bucket add chandq https://github.com/chandq/scoop-bucket && scoop install mock-service-cli-ultra
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

| 选项                       | 描述                                                              | 默认值 |
| -------------------------- | ----------------------------------------------------------------- | ------ |
| `-h` 或 `--help`           | 显示帮助信息                                                      | -      |
| `-p` 或 `--port`           | Mock 服务器端口                                                   | 8090   |
| `-d`                       | 指定 mock 目录                                                    | ./mock |
| `-f`                       | 指定单个 mock 文件                                                | -      |
| `-s` 或 `--silent`         | 抑制日志输出                                                      | -      |
| `-v` 或 `--version`        | 显示版本信息                                                      | -      |
| `-S` 或 `--socket-server`  | 启动 socket 服务器，用于保存 API 响应数据                         | false  |
| `-a` 或 `--api-stat`       | 打印 API URL 和文件路径信息                                       | false  |
| `-t` 或 `--track`          | 记录操作信息到文件                                                | false  |
| `-o` 或 `--cors-origin`    | 配置 CORS 允许的源，多个源用逗号分隔                              | \*     |
| `-O` 或 `--proxy-options`  | 配置 HTTP 请求代理选项，支持 js 文件、json 文件或命令行参数       | -      |
| `-r` 或 `--rewrite`        | rewrite http or https request url prefix of proxy, default false. | false  |
| `-H` 或 `--cors-headers`   | 配置 CORS 头信息                                                  | \*     |
| `-A` 或 `--append-headers` | 添加响应头信息，多个头用逗号分隔                                  | -      |
| `-D` 或 `--web-dir`        | 启用 Web 服务器，指定 web 目录（SPA 应用）                        | -      |
| `-P` 或 `--web-port`       | Web 服务器端口                                                    | 9090   |
| `-b` 或 `--web-baseurl`    | 指定 SPA Web 服务器的公共路径                                     | -      |
| `-R` 或 `--static-server`  | 启用单目录静态服务器，指定静态资源目录                            | -      |
| `--spa-fallback <path>`    | 单目录模式显式启用 SPA 回退                                       | -      |
| `--static-config <file>`   | 使用自包含 JSON 配置启动静态服务器                                | -      |
| `-w` 或 `--open`           | 自动打开可用的 Web 页面或 API 概览页                               | false  |
| `--watch-depth <n>`        | 限制静态服务器文件监听递归深度（非负整数）                         | 无限   |
| `-e` 或 `--explorer`       | 启用文件浏览器服务器，指定要浏览的目录                            | ./     |
| `--edit`                   | 启用文件浏览器的新建、重命名、删除和上传操作                      | false  |
| `--auth <password>`        | 为文件浏览器启用密码认证（仅可搭配 `--explorer`）                 | -      |
| `--host [allowlist-file]`  | 暴露全部 IPv4 网卡；传入文件时仅允许白名单 IP 访问                | false  |

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

# 单目录模式启用 SPA 回退
mock-service-cli -R ./public --spa-fallback /index.html

# 使用自包含配置（不需要目录参数）
mock-service-cli -R --static-config ./static-server.json
mock-service-cli --static-config ./static-server.json
```

静态服务器会监听资源变化并向 HTML 页面注入热更新客户端：CSS 文件更新时替换样式表，其余变更刷新页面。
默认不打开浏览器；使用 `-w/--open` 可自动打开静态服务器页面。也可在配置中设置 `"open": true` 或提供页面路径。完整配置字段和示例见
[`docs/static-server.config.example.json`](./docs/static-server.config.example.json)：支持忽略规则、SPA 回退、挂载目录、代理、HTTPS、CORS、响应头和自定义浏览器命令。
`watch.depth` 可限制 chokidar 递归监听层数；未设置时为无限深度，大目录建议显式设置有限值。命令行 `--watch-depth <n>` 优先于配置文件。
配置文件只在顶层保留服务器级字段。所有应用都放在 `mounts` 中，并可独立设置 `directory`、`spaFallback`、`proxy`、`cors`、`headers`、`requestHeaders` 和 `secure`。mount 未设置 `path` 时默认挂载到 `/`；`directory` 可省略，但该应用必须配置至少一条代理。代理键使用完整公开路径，例如 `/api/app`。
`headers` 是发送给客户端的响应头。`requestHeaders` 是发送给该应用全部代理上游的请求头；也可放在单个 `proxy` 规则中，覆盖或追加 mount 级请求头。代理规则使用 `{ "target": "http://...", "rewrite": true }`；`rewrite` 为 true 时只移除匹配的完整代理前缀并保留剩余路径和 query string。应用级 `secure` 控制其代理 HTTPS 目标的证书校验，默认 `false`。配置模式不接受 `--proxy-options`、`--rewrite` 或 `--spa-fallback`。
未设置 `spaFallback` 时，应用目录会显示可点击的目录索引；可直接访问其中的 HTML 文件。mount 未命中的路由不会继续进入其他应用的 SPA fallback。
设置了 `spaFallback` 的应用可选配置 `accessLog.success` 与 `accessLog.failure` 文件路径。服务将把每次访问以 JSON Lines 写入对应文件：2xx/3xx 写入 success，4xx/5xx 写入 failure；路径相对配置文件解析。启动后控制台会突出显示每条代理所属的应用、公开前缀、目标和 rewrite 状态。

### Web 服务器 (SPA)

```bash
# 启动 SPA 服务器
mock-service-cli -D ./dist

# 指定公共路径和端口
mock-service-cli -D ./dist -b /app -P 9090

# 自动打开 Web 页面
mock-service-cli -D ./dist --open
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

# 启用文件编辑操作
mock-service-cli -e ./ --edit

# 启用文件浏览器密码认证
mock-service-cli -e ./ --auth 'local-password'

# 暴露到局域网（编辑操作仍需额外传入 --edit）
mock-service-cli -e ./ --host

# 仅向白名单 IP 暴露服务
mock-service-cli -e ./ --host ./allowed-ips.txt
```

默认情况下，Mock、SPA、Static 和 File Explorer 服务只监听 `127.0.0.1`。
`--host` 会使这些服务监听所有 IPv4 网卡，请仅在可信网络中使用。传入白名单文件时，服务仍监听全部 IPv4 网卡，
但仅允许 `localhost`、`127.0.0.1`、`::1` 及文件中的 IP/CIDR 访问；空行和行首 `#` 注释会忽略，非法或空白名单会阻止启动。
该规则同时作用于 Mock、SPA、Static、File Explorer 和 Socket 服务。

文件浏览器默认只读；必须在启动时传入 `--edit` 才能创建、重命名、删除或上传。上传文件支持多选，上传文件夹会保留目录层级；
同名路径不会覆盖，其他无冲突文件仍会继续上传。单文件和单次请求最大 2GB，单次最多 100 个文件；
文件夹上传会按最多 100 个文件且 1GB 自动分批，依次完成上传。大文件会先写入系统临时目录再复制到目标目录，
上传时请确保临时目录和目标磁盘合计至少有文件大小两倍的可用空间。

编辑模式下还可压缩选中项、预览压缩包目录和解压压缩包。轻量版创建压缩包支持 ZIP 和 TAR.GZ，预览和解压支持 ZIP、TAR 与 TAR.GZ；归档操作在后台执行，可取消；单个压缩包及解压后的总大小上限为 2GB，压缩包内最多 10,000 项，且会拒绝加密包、路径穿越、符号链接和目标冲突。

Ultra 版额外支持 RAR、7z、gzip、bzip2 与 xz 系列的预览和解压；RAR 为只读支持，不能创建。Ultra 包会额外安装约 12MB 的跨平台 7-Zip 二进制，RAR 通过只读解码器处理；轻量版不包含这些二进制。

`--auth` 会在文件浏览器中显示登录页，并在每次页面加载和每个 API 请求时验证密码。密码仅保存在当前浏览器标签页的
`sessionStorage` 中，但命令行参数仍可能暴露在 shell 历史和进程列表里，因此只适用于可信本机或局域网环境。

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
