# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [3.1.2](https://github.com/chandq/mock-service-cli/compare/v3.1.1...v3.1.2) (2022-08-07)

### [3.1.1](https://github.com/chandq/mock-service-cli/compare/v3.1.0...v3.1.1) (2022-07-25)


### Bug Fixes

* node 18下chalk丢失问题 ([fb80d8d](https://github.com/chandq/mock-service-cli/commit/fb80d8d94feee8d3177b69a2c4509a390880bd56))
* update some npm version for security ([f0aa1df](https://github.com/chandq/mock-service-cli/commit/f0aa1dfa51f36bde693b0da12bec2b653b1b6003))

## [3.1.0](https://github.com/chandq/mock-service-cli/compare/v3.0.0...v3.1.0) (2022-04-27)


### Features

* **web-proxy:** proxy配置项支持文件和命令行参数字符串两种 ([ee1ce1f](https://github.com/chandq/mock-service-cli/commit/ee1ce1fbefa5ce9b3c074192d2d9893a4414d346))

## [3.0.0](https://github.com/chandq/mock-service-cli/compare/v2.5.1...v3.0.0) (2022-04-27)


### Features

* add web server and request proxy ([e5be340](https://github.com/chandq/mock-service-cli/commit/e5be340940042eb05e2e5cb9d2fcc6f8316052d5))

### [2.5.1](https://github.com/chandq/mock-service-cli/compare/v2.5.0...v2.5.1) (2022-04-25)

## [2.5.0](https://github.com/chandq/mock-service-cli/compare/v2.4.0...v2.5.0) (2022-04-25)


### Features

* **cors:** 支持cors-origin,cors-headers跨域配置 ([c2d2872](https://github.com/chandq/mock-service-cli/commit/c2d28723d047139a5165190b4ba197f46470f72f))
* 缓存mock统计信息 ([1ee87cd](https://github.com/chandq/mock-service-cli/commit/1ee87cd041e68b9f17b64e9e3cb906681cb855fc))


### Bug Fixes

* 修复无法同时保留相同url不同请求类型的响应数据 ([90326dc](https://github.com/chandq/mock-service-cli/commit/90326dc556760eb81efadd76b031366452c95d2b))

### [2.4.3](https://github.com/chandq/mock-service-cli/compare/v2.4.2...v2.4.3) (2022-01-20)

### [2.4.2](https://github.com/chandq/mock-service-cli/compare/v2.4.1...v2.4.2) (2022-01-07)


### Features

* 缓存mock统计信息 ([1ee87cd](https://github.com/chandq/mock-service-cli/commit/1ee87cd041e68b9f17b64e9e3cb906681cb855fc))

### [2.4.1](https://github.com/chandq/mock-service-cli/compare/v2.4.0...v2.4.1) (2022-01-06)


### Bug Fixes

* 修复无法同时保留相同url不同请求类型的响应数据 ([90326dc](https://github.com/chandq/mock-service-cli/commit/90326dc556760eb81efadd76b031366452c95d2b))

## [2.4.0](https://github.com/chandq/mock-service-cli/compare/v2.3.2...v2.4.0) (2022-01-05)


### Features

* 增加异步任务队列，移出不必要模块 ([c7f3608](https://github.com/chandq/mock-service-cli/commit/c7f3608e4d0185434154d6f8d84889f281147022))

### [2.3.2](https://github.com/chandq/mock-service-cli/compare/v2.3.1...v2.3.2) (2022-01-02)


### Bug Fixes

* be sure to write file successfully ([55415e3](https://github.com/chandq/mock-service-cli/commit/55415e387af4d8232db2bede0a51dad1dca474b3))

### [2.3.1](https://github.com/chandq/mock-service-cli/compare/v2.2.0...v2.3.1) (2022-01-01)


### Bug Fixes

* issue of execute unit test case failed ([69f4609](https://github.com/chandq/mock-service-cli/commit/69f46099ed5b26de5d4cca523c56afcbf4db5f2c))

## [2.2.0](https://github.com/chandq/mock-service-cli/compare/v2.1.1...v2.2.0) (2021-12-31)


### Features

* 丰富日志工具函数 ([4dcd69c](https://github.com/chandq/mock-service-cli/commit/4dcd69c6400f65aaf77ea4a2923c9900d5954d09))
* 监听文件变化和写文件互斥执行 ([cfeab8e](https://github.com/chandq/mock-service-cli/commit/cfeab8ede05573974125a9fa91f1db6afa8a898d))
* record operation log ([42b74d8](https://github.com/chandq/mock-service-cli/commit/42b74d8be0e694600c999490d3fe93bfb3620051))


### Bug Fixes

* issue of write large file failed ([d1c470d](https://github.com/chandq/mock-service-cli/commit/d1c470daf9829916016b73993b114fc5ffe3c985))

### [2.1.1](https://github.com/chandq/mock-service-cli/compare/v2.1.0...v2.1.1) (2021-12-30)


### Bug Fixes

* issue of  friendly show error tip ([e9822c2](https://github.com/chandq/mock-service-cli/commit/e9822c2038ad411d91a170af33e7541e266ca8e6))
* issue of empty file content ([3949e00](https://github.com/chandq/mock-service-cli/commit/3949e00a46b4555bc08ec8564221cc230c780dcb))

## [2.1.0](https://github.com/chandq/mock-service-cli/compare/v2.0.5...v2.1.0) (2021-12-30)


### Features

* 根据命令行参数决定是否 打印api统计信息 ([0e838db](https://github.com/chandq/mock-service-cli/commit/0e838db7820fd096163d14eb87abbd9b852b6a0e))
* add arguments description ([097b373](https://github.com/chandq/mock-service-cli/commit/097b3733a1da0b43dae6b50080d270323b92f0d2))


### Bug Fixes

* issue of comment typo ([85297a5](https://github.com/chandq/mock-service-cli/commit/85297a5895fd7c0446ee8b90a58ebed90a02e9e7))
* issue of maybe write content to file failed ([8ed910b](https://github.com/chandq/mock-service-cli/commit/8ed910b1e9687cae46ad6bdab641db0c305c83fb))
* socket connection show datetime ([c6db3b4](https://github.com/chandq/mock-service-cli/commit/c6db3b47a2370dc1c9aba5495dbb6606c20eb0c9))

### [2.0.5](https://github.com/chandq/mock-service-cli/compare/v2.0.4...v2.0.5) (2021-12-28)


### Bug Fixes

* validate func parameter to avoid exception ([32e4d28](https://github.com/chandq/mock-service-cli/commit/32e4d28114a4907352491e16829d37345fbab9d9))

### [2.0.4](https://github.com/chandq/mock-service-cli/compare/v2.0.3...v2.0.4) (2021-12-27)


### Bug Fixes

* get valid api url for route ([8770751](https://github.com/chandq/mock-service-cli/commit/877075107ea60244a52e345f37b7df855752d5f6))

### [2.0.3](https://github.com/chandq/mock-service-cli/compare/v2.0.2...v2.0.3) (2021-12-27)


### Bug Fixes

* convert windows file path to api url ([1f15b33](https://github.com/chandq/mock-service-cli/commit/1f15b334ab5374bc102e5e11fbfaae994569bca5))

### [2.0.2](https://github.com/chandq/mock-service-cli/compare/v2.0.1...v2.0.2) (2021-12-27)


### Bug Fixes

* issue of convert path ([5276488](https://github.com/chandq/mock-service-cli/commit/527648866f20fd25b5df0dc55b3898d7e7a1ad2c))

### [2.0.1](https://github.com/chandq/mock-service-cli/compare/v2.0.0...v2.0.1) (2021-12-27)


### Bug Fixes

* issue of executed failed under windows ([e160753](https://github.com/chandq/mock-service-cli/commit/e16075307e9fec8efcce464004b0881884f68ab8))

## [2.0.0](https://github.com/chandq/mock-service-cli/compare/v1.2.1...v2.0.0) (2021-12-25)


### Features

* 新增根据api自动生成mock文件、获取mock统计数据的工具函数 ([b22cb6f](https://github.com/chandq/mock-service-cli/commit/b22cb6fa15787a1343ec6d11606d2a59a670171b))
* add c/s communication base on  socket.io ([d0ce542](https://github.com/chandq/mock-service-cli/commit/d0ce5422ece5f7c36d6e74f06620b54096e84f73))
* add hasMockApi function ([e14231b](https://github.com/chandq/mock-service-cli/commit/e14231b8385835b59f4e0960b37b4379e4853155))
* add mock-dir-stat mock-file-stat  event ([8d8b1fa](https://github.com/chandq/mock-service-cli/commit/8d8b1faf130c84fe35bf205e68ca9634ee8ff767))


### Bug Fixes

* logical judge issue ([1e40b13](https://github.com/chandq/mock-service-cli/commit/1e40b134cfcbfd908346ed701cfd18c39502153b))
* mock-list.json未及时更新的问题 ([4bb42f5](https://github.com/chandq/mock-service-cli/commit/4bb42f506ca1bab6958554ba6043a721bc296555))

### [1.2.1](https://github.com/chandq/mock-service-cli/compare/v1.2.0...v1.2.1) (2021-11-28)

## [1.2.0](https://github.com/chandq/mock-service-cli/compare/v1.1.1...v1.2.0) (2021-11-27)


### Features

* 支持除get请求之外的其他所有常用类型 ([a1bd549](https://github.com/chandq/mock-service-cli/commit/a1bd549e24da958178a3b1244c4b2f472dfcc643))

### [1.1.1](https://github.com/chandq/mock-service-cli/compare/v1.1.0...v1.1.1) (2021-10-27)

## [1.1.0](https://github.com/chandq/mock-service-cli/compare/v1.0.2...v1.1.0) (2021-10-27)

### [1.0.2](https://github.com/chandq/mock-service-cli/compare/v1.0.1...v1.0.2) (2021-10-26)


### Bug Fixes

* recursively through subdirectories ([d11813c](https://github.com/chandq/mock-service-cli/commit/d11813c48175550c6592e52f2fd1abe1c63f8203))

### [1.0.1](https://github.com/chandq/mock-service-cli/compare/v1.0.0...v1.0.1) (2021-10-25)

## [1.0.0](https://github.com/chandq/mock-service-cli/compare/v0.2.1...v1.0.0) (2021-10-25)


### Bug Fixes

* default mock directory issue ([064cd90](https://github.com/chandq/mock-service-cli/commit/064cd903cbc891eaa068ac3c38606e37ec529257))
* make silent argument take effect ([5aa472b](https://github.com/chandq/mock-service-cli/commit/5aa472b34cee4b93683a3cc282bba0b9ad52048e))

### [0.2.1](https://github.com/chandq/mock-service-cli/compare/v0.1.1...v0.2.1) (2021-10-22)


### Bug Fixes

* 纠正devDep和deps的包分类 ([25cf330](https://github.com/chandq/mock-service-cli/commit/25cf3308337220210a2daccaf9d09444eddb1b24))

## [0.2.0](https://github.com/chandq/mock-service-cli/compare/v0.1.1...v0.2.0) (2021-10-22)


### Bug Fixes

* 纠正devDep和deps的包分类 ([25cf330](https://github.com/chandq/mock-service-cli/commit/25cf3308337220210a2daccaf9d09444eddb1b24))

### [0.1.1](https://github.com/chandq/mock-service-cli/compare/v0.1.0...v0.1.1) (2021-10-22)

## 0.1.0 (2021-10-22)


### Features

* initial commit ([c8c8a1a](https://github.com/chandq/mock-service-cli/commit/c8c8a1a8268eab16411a2d1d6b0ee90e8de4cb35))
