# API Client 接口工作台

API Client 是独立启动的本地 HTTP 调试工具。无需账号、云服务或 CDN；请求由运行 CLI 的机器发送，因此不受目标接口的浏览器 CORS 限制。light 和 ultra 提供相同功能，支持 Node.js 18 及以上。

```bash
mock-service-cli --api-client --open
mock-service-cli --api-client ./api-tests --port 8090
mock-service-cli --api-client ./api-tests --port 0
mock-service-cli --api-client --host
mock-service-cli --api-client --auth 'password'
mock-service-cli --api-client ./api-tests --host ./allowlist.txt --auth 'password'
```

默认绑定 `127.0.0.1`，从端口 `8090` 开始查找空闲端口，页面在 `/`。`--port <端口号>` 指定查找起点，被占用时自动尝试后续端口；`--port 0` 直接让系统分配端口。实际地址输出到终端，`--open` 打开该地址，`--silent` 隐藏正常启动输出。指定工作区时相对路径按启动目录解析，未指定时为 `./.mock-service-client`。工作区首次保存时才创建。

该模式不能与 Mock、静态服务、文件浏览器、Socket、现有代理参数或 `--edit` 混用。需要同时调试本项目的 Mock API 时，另开一个终端以其他端口启动 Mock 服务。

## 请求调试

请求 Body 选择 JSON 或 XML 后启用语法高亮、括号匹配、行号和代码折叠；Text 保持纯文本。JSON 提供格式化按钮，响应 JSON 也使用按类型区分的配色。高亮随浅色/深色主题切换。

点击顶部“快捷键”可随时查看操作说明。快捷键在工作台页面获得焦点时生效；弹窗打开时暂停发送、保存和请求搜索快捷键。

| 操作 | Windows / Linux | macOS | 范围 |
| --- | --- | --- | --- |
| 发送当前请求 | Ctrl + Enter | ⌘ + Enter | 工作台 |
| 保存当前请求 | Ctrl + S | ⌘ + S | 工作台 |
| 聚焦左侧请求搜索 | Ctrl + K | ⌘ + K | 工作台 |
| 查找 / 替换正文 | Ctrl + F | ⌘ + F | 先点击正文编辑器 |
| 撤销 / 重做 | Ctrl + Z / Ctrl + Shift + Z | ⌘ + Z / ⌘ + Shift + Z | 正文编辑器 |
| 缩进 / 取消缩进 | Tab / Shift + Tab | Tab / Shift + Tab | 正文编辑器 |
| 离开正文编辑器 | 先 Escape，再 Tab | 先 Escape，再 Tab | 正文编辑器 |

行号旁的折叠箭头可收起或展开 JSON/XML 块。JSON 格式化也支持撤销。编辑器加载失败时会显示提示，并保留普通文本框供继续编辑。

左侧组织集合、文件夹及历史，中间编辑请求，右侧查看响应。集合或文件夹旁的 `···` 提供新建、改名、复制、移动、排序及删除操作。请求标签页保留未保存标记；保存使用 `Ctrl/Cmd+S`，发送使用 `Ctrl/Cmd+Enter`，搜索使用 `Ctrl/Cmd+K`。

支持 GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS。URL 和 Params 双向编辑，参数及请求头支持同名重复项、停用和批量粘贴。`Host`、连接控制、代理认证和正文长度等传输头由执行器管理。

Body 支持 JSON、Text、XML、URL 编码表单、multipart 和二进制文件。GET/HEAD 不发送正文。文件由浏览器选择上传；文件引用仅在当前会话中有效，重新打开时需要再次选择。不会根据导入文件中的路径读取服务器磁盘。

认证支持集合继承、None、Basic、Bearer、API Key（Header/Query）。自动认证与显式请求头冲突时拒绝发送并提示。OAuth Token 可自行取得后填入 Bearer。Cookie 管理器支持按目标 URL 新增、更新、查看和清除；实际匹配由 Cookie 的域名、路径、Secure 和有效期决定，浏览器自身的登录 Cookie 不会被转发。

默认超时 30 秒，允许 1–300 秒；默认验证 TLS 证书，可在单请求设置中显式关闭。自动重定向最多 10 次，跨源跳转剥离原请求的敏感头，禁止 HTTPS 降级至 HTTP。失败不自动重试。

响应支持原文、格式化 JSON、按需展开的 JSON 树、搜索、复制及下载。HTML/XML 始终作为文本展示。请求详情展示实发方法、最终 URL、脱敏请求头、重定向链和 TLS 验证状态。响应 HTTP 错误（例如 404）仍作为有效响应展示；网络失败、超时和取消单独反馈。

下载保存完整响应正文（HTTP 压缩已解压），优先采用上游 `Content-Disposition` 中的文件名，并清理路径和非法字符；没有有效文件名时，按 `Content-Type` 生成 `response.json`、`response.txt`、`response.xml` 等文件名，未知类型才使用 `response.bin`。下载始终作为附件传输。

## 环境、凭据与保存

变量写作 `{{name}}`。执行时的优先级为本轮提取变量 → 当前环境 → 集合，Secret 值覆盖所在作用域的同名普通值；请求凭据引用在会话中解析。变量不存在时阻止发送，并指出名称。

环境管理中可以添加普通变量或勾选 Secret。普通值会保存到项目文件；Secret 值仅存当前页面内存，刷新后需要重新填写。直接填写的认证凭据和已识别敏感请求头在发送/保存时转换为 `{{secret_…}}` 引用，可在环境管理的“请求凭据”区域重新填写。任意业务正文无法自动识别敏感字段，含密码的 Body 应手动使用 Secret 变量。导出默认清空明文认证及已识别敏感字段，不导出 Cookie。

工作区结构：

```text
api-tests/
  workspace.json
  collections/<uuid>.json
  environments/<uuid>.json
```

所有资源采用 `schemaVersion: 1`。每个集合包含 `id`、`name`、`variables`、`auth`、`items`；文件夹用 `type: "folder"` 和嵌套 `items` 表示。请求包含 `id`、`name`、`method`、`url`、`query`、`headers`、`body`、`auth`、`settings`、`assertions`、`extractors`。键值列表使用 `{ key, value, enabled }`；变量可以增加 `secret: true`。字段顺序和缩进固定。

保存采用异步原子替换及内容版本检查。多个窗口或外部编辑导致版本不一致时返回 `409`，重新加载最新项目数据后再合并保存。不要直接覆盖冲突文件。写入期间工作区内有短暂的 `.write-lock` 目录；进程异常退出留下锁时，确认没有其他进程写入后可手动移除。

工作区及子目录/资源文件不允许符号链接。不要在运行期间由其他程序替换工作区目录。工作区是可信本地用户的项目目录，不是多租户文件存储。

标签页、布局、主题和最多 500 条历史保存在浏览器 IndexedDB，按工作区隔离；更换浏览器或服务 Origin（包括端口）不会共享这些浏览器状态。历史可恢复请求模板，不记录响应正文或已解析的 Secret。Cookie、上传、执行结果按服务器会话隔离；退出会话清理所有关联数据。

## 断言与集合执行

Tests 面板提供状态码、响应头、耗时及 JSON Pointer 字段的断言，支持等于、存在、包含、类型、小于。期望值可输入 JSON 数字/布尔值或字符串。JSON Pointer 示例：`/data/id`、`/items/0/name`，键中的 `/` 和 `~` 分别写为 `~1` 和 `~0`。

提取规则从 JSON 字段或响应头取得值，后续请求可通过变量引用。例如首个登录请求从 `/data/token` 提取 `token`，后续请求填写 Bearer `{{token}}`。提取值不会写回环境文件。

“运行集合”支持选择请求、迭代次数、间隔及失败后停止。按集合内顺序执行，每轮运行使用独立变量上下文和 Cookie 副本，不修改手动调试 Cookie。可取消、查看每个结果、导出不含正文和凭据的 JSON 报告或清理结果。首版不执行 JavaScript，不作为压力测试工具。

## 导入与导出兼容性

导入先预览数量与兼容性提示，确认后保存为新集合，不覆盖已有集合。

| 格式            | 支持                                                                 | 限制                                                                                       |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| cURL            | 常见方法、URL、重复头、Basic、Cookie、data、表单、文件占位、TLS 设置 | 按 POSIX 引号规则解析；不执行 shell，不读取 `@文件`，不支持的选项报错                      |
| Postman v2.1    | 集合、文件夹、请求、变量、支持的认证、常用 Body                      | 不执行脚本/动态变量；未支持配置显示提示；文件须重新选择                                    |
| OpenAPI 3.0/3.1 | JSON/YAML、标签分组、参数/示例、Body、常用认证、内部 `$ref`          | 不联网加载外部引用；循环引用有限展开；复杂参数序列化、多种认证及多种 Body 需按报告手动检查 |
| 原生 JSON       | `schemaVersion: 1` 集合                                              | 不兼容未知 schemaVersion                                                                   |

导出提供原生集合 JSON 和单请求 cURL；保留变量引用。文件导出为 `@SELECT_FILE` 占位，需要使用者指定路径。

cURL 中的 `Connection`、`Host`、`Content-Length` 等由客户端管理的请求头会保留在 Headers 中但自动停用，导入预览会列出提示，发送时由客户端处理。已导入的旧请求如出现“请求头由客户端管理”，可取消勾选对应请求头或重新导入。

## 访问控制与资源限制

`--host` 与 `--auth` 独立，可单独使用或组合使用。`--host` 开放局域网访问，传入文件时沿用现有 IP/CIDR 白名单规则；`--auth` 为页面、API 和执行结果启用密码认证，单独使用时仍仅监听本机。不设置 `--auth` 时无需密码，仍保留会话隔离以及 Host、Origin 和 API 令牌检查。显式开放 LAN 后，请求从服务端机器发出，具有该机器的网络可达性。局域网服务本身使用 HTTP，应仅在可信网络中使用。

| 资源                        | 上限/默认值           |
| --------------------------- | --------------------- |
| 请求正文 / 单次上传         | 20 MiB                |
| 响应传输 / 解压后正文       | 各 50 MiB             |
| 正文预览                    | 1 MiB，完整结果可下载 |
| 临时文件总大小 / 数量       | 256 MiB / 500 个      |
| 并发执行                    | 每会话 4，全局 16     |
| 等待队列 / 保留任务         | 100 / 300             |
| 集合请求数 / 单轮总执行次数 | 10,000 / 1,000        |
| 迭代次数 / 请求间隔         | 1–100 / 0–30,000 ms   |
| 已完成任务和上传的保留时间  | 30 分钟，定时回收     |
| 空闲会话有效期 / 会话数量   | 12 小时 / 100         |

响应流式写入临时文件，JSON 格式化、树展开和搜索由浏览器 Worker 处理；大响应断言在 Node Worker 中处理。应用启动不加载编辑器，首次编辑正文时按需加载随包提供的 CodeMirror。

## 开发验证

```bash
npm ci
npm run build
npm run test:api-client
npx playwright install chromium
npm run test:browser
npm run lint
npm test
npm run test:src
npm run package:editions
npm run verify:packages
```

源码入口可直接启动；CodeMirror 资源需先构建一次，缺少构建产物时仍可使用原生文本编辑框。浏览器测试产物位于忽略的 `.cache/`。性能测试输出 Node、浏览器与平台版本，检查首屏资源、1,000 条请求搜索和 10 MiB JSON Worker 响应性。Windows 的原生控制台 Ctrl+C 需要在真实终端验证，自动化测试覆盖共享退出适配器。
