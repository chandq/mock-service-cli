[![GitHub Workflow Status (master)](https://img.shields.io/github/workflow/status/chandq/mock-service-cli/Node.js%20CI/master?style=flat-square)](https://github.com/chandq/mock-service-cli/actions)
[![Coverage Status](https://coveralls.io/repos/github/chandq/mock-service-cli/badge.svg?branch=master)](https://coveralls.io/github/chandq/mock-service-cli?branch=master)
[![mock-service-cli](https://img.shields.io/github/package-json/v/chandq/mock-service-cli?style=flat-square)](https://github.com/chandq/mock-service-cli)
[![node](https://img.shields.io/badge/node-v14.0.0-blue)](https://nodejs.org/download/release/v14.0.0/)
[![node](https://img.shields.io/badge/language-node-orange.svg)](https://nodejs.org/download/release/v12.0.0/)
[![license:MIT](https://img.shields.io/npm/l/vue.svg?sanitize=true)](https://github.com/chandq/mock-service-cli/blob/master/LICENSE.md)
[![Downloads:?](https://img.shields.io/npm/dm/mock-service-cli.svg?sanitize=true)](https://npmcharts.com/compare/mock-service-cli?minimal=true)

# ð¦ ä¸ä¸ªåºäº [node](https://nodejs.org/en/) å [express](https://www.expressjs.com.cn/) ç è½»éçº§ Mock å¥ä»¶ å½ä»¤è¡å·¥å·

### ç®ä»

åç½® Mock ServerãWeb ServerãHttp request proxy ç­åè½éã

**ç®æè½»é**ã**B/S æ¶æ**ã**0 ç§å¯å¨**çæ¬å°å½ä»¤è¡ Mock æå¡å¥ä»¶ï¼ æ¯æç­æ´æ°ï¼å¯¹äºå¼åè°è¯ mock æ°æ®å¾å®ç¨ï¼è½æé«åç«¯å¼åèçå¼åæçãæ¯æ `GET`,`POST`,`PUT`,`DELETE`,`PATCH`,`OPTIONS`,`COPY`,`LINK`,`UNLINK`,`PURGE` ç­å¸¸ç¨è¯·æ±ç±»åï¼æ éå¸ç½²åç«¯ï¼å¯è½æ¯æ¬å°æå¥½ç¨ç Mock å·¥å·ãæ¯æä»¥ä¸å¸¸è§ä¸å¡åºæ¯ï¼

- [x] æ æå¡ç«¯æ¼ç¤ºé¡¹ç®çæ°æ® Mock
- [x] ä¸å¡å¼åæ¥å£èè°åçæ°æ® Mock
- [x] ä¿çä¸å¡é¡¹ç®çæææé¨åæ¥å£çååºæ°æ®(åå¥æä»¶)
- [x] ä¿éåç«¯å¼åè°è¯ä¸ååç«¯æå¡å½±å(å½åç«¯æå¡æææé¨åæ¥å£ååºå¼å¸¸æ¶å¯ç¨ Mock)

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

| Command                   | Description                                                                                                                                                                                                                                                                                                          | Defaults |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `-h` or `--help`          | Print this list and exit.                                                                                                                                                                                                                                                                                            |          |
| `-p` or `--port`          | Mock server port to use. Use `-p 8090` to look for an open port, starting at 8090.                                                                                                                                                                                                                                   | 8090     |
| `-d`                      | Specify mock directory                                                                                                                                                                                                                                                                                               | ./mock   |
| `-f`                      | Specify mock file                                                                                                                                                                                                                                                                                                    |          |
| `-s` or `--silent`        | Suppress log messages from output                                                                                                                                                                                                                                                                                    |          |
| `-v` or `--version`       | Print the version and exit.                                                                                                                                                                                                                                                                                          |          |
| `-S` or `--socket-server` | Start socket server which used to save api response data for future mock.                                                                                                                                                                                                                                            | false    |
| `-a` or `--api-stat`      | Whether print api url and file path info or not, default false.                                                                                                                                                                                                                                                      | false    |
| `-l` or `--log`           | Whether record operation info by write file, default false.                                                                                                                                                                                                                                                          | false    |
| `-o` or `--cors-origin`   | Allow origin by cors, list separated by commas, must not be \* when withCredential is true .If specified, cors-headers will be `Authorization,Content-Type,Accept,Origin,User-Agent,DNT,Cache-Control,X-Mx-ReqToken,X-Data-Type,X-Requested-With,X-Data-Type,X-Auth-Token,Token`                                     | \*       |
| `-O` or `--proxy-options` | Optionally provide http request proxy options list, support accept js fileãjson fileãcli arguments string. Examples: `-O '/api/apaas\|http://192.168.0.105:60700,/api/permission\| http://192.168.0.105:60700'`. Must start web server to use proxy for http request test under browser console or api test tools. | -        |
| `-P` or `--web-port`      | Web server port to use. Use `-P 9090` to look for an open port, starting at 9090                                                                                                                                                                                                                                     | 9090     |
| `-b` or `--web-baseurl`   | Specify public path of the static web server, can be base address of SPA route.                                                                                                                                                                                                                                      | -        |

## Example

1. Specify mock server port.

`mock-service-cli -p 8085`

2. Enable cors of mock server, specify the origin and headers of http request.

`mock-service-cli -o "http://192.168.0.8:38200,http://10.30.30.3" -H "custom-header"`

3. Specify mock directory.

`mock-service-cli -d ./mock`

4. Specify mock file.

`mock-service-cli -f ./mock/test.js`

5. Start socket server for used to save api response data.

`mock-service-cli -S`

6. Start static web server for SPA, and optionally specify public path and port.
   `mock-service-cli -D ../react-best-practice/dist [-b '/redbridge/'] [-P 9090]`

7. Enable Proxy base on above item 6. support accept js fileãjson fileãcli arguments string

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

### ç¼å Mock æä»¶

> mock è¯·æ±çç±»åæ¯æ`GET`,`POST`,`PUT`,`DELETE`,`PATCH`,`OPTIONS`,`COPY`,`LINK`,`UNLINK`,`PURGE`

å¦æ `./mock/test.js` çåå®¹å¦ä¸ï¼

```javascript
module.exports = {
  // GET å¯å¿½ç¥
  '/mock/mock/api/test': { aa: 1, bb: 'é»è®¤GETè¯·æ±' },
  'GET /mock/api/:id/test': { aa: 1, bb: 'ä½¿ç¨idå ä½ç¬¦' },
  'GET /mock/api/test1': { aa: 1, bb: 'æå®GET æ¹æ³' },
  'POST /mock/api/test': { aa: 1, bb: 'POST æ¹æ³' },
  'DELETE /mock/api/test': { aa: 1, bb: 'DELETE æ¹æ³' },
  'PUT /mock/api/test': { aa: 1, bb: 'PUT æ¹æ³' },
  'PATCH /mock/api/test': { aa: 1, bb: 'PATCH æ¹æ³' },
  'OPTIONS /mock/api/test': { aa: 1, bb: 'OPTIONS æ¹æ³' },
  'COPY /mock/api/test': { aa: 1, bb: 'COPY æ¹æ³' },
  'LINK /mock/api/test': { aa: 1, bb: 'LINK æ¹æ³' },
  'UNLINK /mock/api/test': { aa: 1, bb: 'UNLINK æ¹æ³' },
  'PURGE /mock/api/test': { aa: 1, bb: 'PURGE æ¹æ³' },
  // æ¯æèªå®ä¹å½æ°ï¼API åè express@4
  '/mock/api/video/test': (req, res) => {
    // æ·»å ç¹å®è¯·æ±å¤´token
    res.header('token', '5848778333359208');
    res.json({ aa: 1, bb: 'asdf' });
  }
};
```

ç¶åè®¿é® `æ¬å°ä»£çå°å` + `/mock/api/222/test` ï¼ä¾å¦`http://127.0.0.1:8090/mock/api/222/test`ï¼ å°±è½å¾å° { aa: 1, bb: 'ä½¿ç¨ id å ä½ç¬¦' } çååºï¼å¶ä»ä»¥æ­¤ç±»æ¨ã

![Mock Server](/assets/mock-server.jpg)

### å¼å¥ Mock.js

[Mock.js](http://mockjs.com/) æ¯å¸¸ç¨çè¾å©çææ¨¡ææ°æ®çä¸æ¹åºï¼åå©ä»å¯ä»¥æåæä»¬ç mock æ°æ®è½åã

æ¯å¦ï¼

```js
const mockjs = require('mockjs');

module.exports = {
  // ä½¿ç¨ mockjs ç­ä¸æ¹åº
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

### å¯å¨ Web Server, å¨æ¬å°å nginx ä¸æ ·è¿è¡ dist æä»¶å¯¹åºç SPA

![Web Server](/assets/web-server.jpg)

### å¯å¨ Web Server, å¯ç¨ Proxy

![Web Server Proxy](/assets/web-server-proxy.jpg)

### åå© socket.io ä¿çæ¥å£æ°æ®

> `save-data` å `mock-dir-stat` äºä»¶ä¼èªå¨çæ `mock-list.json` æä»¶ï¼ç»´æ¤æ¥å£`<url, [method]>`çå³ç³»æ å°ï¼ï¼æ¹ä¾¿æ¥éæ¥å£ç»è®¡ä¿¡æ¯

```js
// è¿æ¥SocketServer
import { io } from 'socket.io-client';

const socket = io.connect('http://{MockServerIP}:{PORT}/mock-data', {
  transports: ['websocket'],
  path: '/ws/mock-service'
});
// åSocketServeråæ¶æ¯ï¼ä¿å­æ¥å£æ°æ®
socket.emit('save-data', { url, method, data, dir });
// åSocketServeråæ¶æ¯ï¼è·åæå®ç®å½çMockç»è®¡ä¿¡æ¯
socket.emit('mock-dir-stat', dirPath);
// çå¬SocketServeræ¶æ¯ï¼è·åæå®ç®å½çMockç»è®¡ä¿¡æ¯
socket.on('mock-dir-stat', function (mockDirStat) {});
// åSocketServeråæ¶æ¯ï¼è·åæå®æä»¶çMockç»è®¡ä¿¡æ¯
socket.emit('mock-file-stat', filePath);
// çå¬SocketServeræ¶æ¯ï¼è·åæå®æä»¶çMockç»è®¡ä¿¡æ¯
socket.on('mock-file-stat', function (mockFileStat) {});
```

å¨ axios.js æä»¶ä¸­å®æä¿å­æææ¥å£ååºæ°æ®ãæ ¹æ® Mock æ°æ®æ± èªå¨ Mock çæä½, ç¤ºä¾å¦ä¸ï¼

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
// ä¿å­æææ¥å£ååºæ°æ®ï¼ä¹å¯è¿æ»¤é¨åæ¥å£ï¼
axios.interceptors.response.use(res => {
  const {
    config: { method, url },
    data
  } = res;
  socket.emit('save-data', { url, method, data, dir: '/home/chen/projects/model-ui/mock' });
  return res;
});
// æ ¹æ®Mockæ°æ®æ± èªå¨Mockï¼ä¹å¯æ ¹æ®å®éåºæ¯å³å®æ¯å¦Mockï¼
axios.interceptors.request.use(config => {
  if (Object.keys(mockObj).includes(`${config.method} ${config.url}`)) {
    config.baseURL = 'http://localhost:8090';
  }
  return config;
});
```
