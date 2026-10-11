const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { CookieJar } = require('tough-cookie');
const { Workspace } = require('./store');
const { Engine } = require('./engine');
const { preview, exportCurl } = require('./importers');
const { LIMITS, fail, check, safeObject } = require('./model');
const { getServerHost, hostAllowlistMiddleware, getServerUrls, openPathInFileManager } = require('../utils');
const API = '/__api-client/api';
const route = handler => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res))
    .catch(next);

function createClientServer(options = {}) {
  const app = express();
  const workspace = new Workspace(options.root || process.env.API_CLIENT_DIRECTORY || '.mock-service-client');
  const password = options.password ?? process.env.API_CLIENT_AUTH ?? '';
  const host = options.host || getServerHost();
  const engine = new Engine();
  const sessions = new Map();
  const attempts = new Map();
  const cookieName = `msc_${crypto.randomBytes(8).toString('hex')}`;
  const assets = fs.existsSync(path.join(__dirname, 'api-client'))
    ? path.join(__dirname, 'api-client')
    : path.join(__dirname, 'browser');
  const addresses = new Set(['localhost', '127.0.0.1']);
  if (host === '0.0.0.0')
    for (const list of Object.values(os.networkInterfaces()))
      for (const info of list || []) if (info.family === 'IPv4') addresses.add(info.address);
  const server = http.createServer(app);
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  function newSession(res) {
    if (sessions.size >= 100) throw fail('会话数量已达上限', 429);
    const session = {
      id: crypto.randomBytes(32).toString('hex'),
      token: crypto.randomBytes(32).toString('hex'),
      jar: new CookieJar(),
      time: Date.now()
    };
    sessions.set(session.id, session);
    res.set('Set-Cookie', `${cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/`);
    return session;
  }
  app.disable('x-powered-by');
  app.use(hostAllowlistMiddleware());
  app.use((req, res, next) => {
    let incoming;
    try {
      incoming = new URL(`http://${req.headers.host}`);
    } catch {
      return res.status(403).json({ error: 'Host 无效' });
    }
    if (
      !addresses.has(incoming.hostname) ||
      Number(incoming.port || 80) !== server.address()?.port ||
      req.headers.host !== incoming.host
    )
      return res.status(403).json({ error: 'Host 不受信任' });
    if (
      (req.headers.origin && req.headers.origin !== incoming.origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ error: '不允许跨站访问' });
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
    });
    const sessionId = (req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    req.clientSession = sessions.get(sessionId);
    if (req.clientSession) req.clientSession.time = Date.now();
    next();
  });
  app.get('/login', (req, res) => res.sendFile(path.join(assets, 'login.html')));
  app.get('/login.js', (req, res) => res.sendFile(path.join(assets, 'login.js')));
  app.get('/client.css', (req, res) => res.sendFile(path.join(assets, 'client.css')));
  app.post(
    `${API}/session`,
    express.json({ limit: '16kb' }),
    route((req, res) => {
      check(req.headers.origin === `http://${req.headers.host}`, '登录需要同源 Origin');
      const remote = req.socket.remoteAddress;
      const now = Date.now();
      const attempt = attempts.get(remote) || { time: now, count: 0 };
      if (now - attempt.time > 60000) {
        attempt.time = now;
        attempt.count = 0;
      }
      if (++attempt.count > 10) throw fail('尝试过于频繁，请稍后再试', 429);
      if (attempts.size < 1000 || attempts.has(remote)) attempts.set(remote, attempt);
      const supplied = Buffer.from(String(req.body.password || ''));
      const expected = Buffer.from(password);
      if (password && (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)))
        throw fail('密码错误', 401);
      const session = req.clientSession || newSession(res);
      attempts.delete(remote);
      res.json({ token: session.token });
    })
  );
  app.get(
    '/',
    route((req, res) => {
      if (!req.clientSession && password) return res.redirect('/login');
      if (!req.clientSession) newSession(res);
      res.sendFile(path.join(assets, 'index.html'));
    })
  );
  app.use((req, res, next) => {
    if (!req.clientSession) return res.status(401).json({ error: '请先登录工作台' });
    next();
  });
  app.get(`${API}/config`, (req, res) =>
    res.json({
      schemaVersion: 1,
      workspaceId: workspace.id,
      workspaceName: path.basename(workspace.root),
      token: req.clientSession.token,
      limits: LIMITS,
      authEnabled: Boolean(password)
    })
  );
  app.get('/client.js', (req, res) => res.sendFile(path.join(assets, 'client.js')));
  app.get('/worker.js', (req, res) => res.sendFile(path.join(assets, 'worker.js')));
  app.get('/editor.js', (req, res) => {
    const file = path.join(assets, 'editor.js');
    const bundled = path.resolve(__dirname, '../../../dist/api-client/editor.js');
    res.sendFile(fs.existsSync(path.join(assets, 'index.html')) && assets.endsWith('api-client') ? file : bundled);
  });
  app.use(API, (req, res, next) => {
    if (req.get('X-Api-Client-Token') !== req.clientSession.token)
      return res.status(403).json({ error: '会话令牌无效' });
    next();
  });
  app.post(
    `${API}/uploads`,
    route(async (req, res) => {
      check(req.is('application/octet-stream'), '上传需要 application/octet-stream');
      const file = await engine.files.create(req.clientSession.id);
      file.upload = true;
      file.name = String(req.get('X-File-Name') || 'file').slice(0, 200);
      try {
        file.name = decodeURIComponent(file.name);
      } catch {
        /* Keep an opaque filename. */
      }
      let size = 0;
      const count = new Transform({
        transform(chunk, encoding, callback) {
          try {
            size += chunk.length;
            check(size <= LIMITS.request, '上传超过 20 MiB');
            engine.files.add(file, chunk.length);
            callback(null, chunk);
          } catch (error) {
            callback(error);
          }
        }
      });
      try {
        await pipeline(req, count, fs.createWriteStream(file.path, { flags: 'wx', mode: 0o600 }));
        res.status(201).json({ uploadId: file.id, name: file.name, size: file.size });
      } catch (error) {
        await engine.files.remove(file.id);
        throw error;
      }
    })
  );
  app.use(API, express.json({ limit: '21mb' }));
  app.use(API, (req, res, next) => {
    try {
      safeObject(req.body);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.delete(
    `${API}/session`,
    route(async (req, res) => {
      await removeSession(req.clientSession);
      res.set('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`).json({ success: true });
    })
  );
  for (const kind of ['collections', 'environments']) {
    app.get(
      `${API}/${kind}`,
      route(async (req, res) => res.json(await workspace.list(kind)))
    );
    app.put(
      `${API}/${kind}/:id`,
      route(async (req, res) => res.json(await workspace.write(kind, req.params.id, req.body, req.get('If-Match'))))
    );
    app.delete(
      `${API}/${kind}/:id`,
      route(async (req, res) => res.json(await workspace.write(kind, req.params.id, null, req.get('If-Match'), true)))
    );
  }
  app.post(
    `${API}/imports/preview`,
    route((req, res) => res.json(preview(req.body.format, req.body.text)))
  );
  app.post(
    `${API}/exports/curl`,
    route((req, res) => res.json({ text: exportCurl(req.body) }))
  );
  app.post(
    `${API}/executions`,
    route((req, res) => {
      const job = engine.submit(req.clientSession.id, req.body, req.clientSession.jar);
      res.status(202).json({ executionId: job.id });
    })
  );
  app.get(
    `${API}/executions/:id`,
    route((req, res) => {
      const after = Number(req.query.after || 0);
      check(Number.isInteger(after) && after >= 0, '结果偏移无效');
      res.json(engine.view(engine.get(req.params.id, req.clientSession.id), after));
    })
  );
  app.post(
    `${API}/executions/:id/cancel`,
    route((req, res) => {
      engine.cancel(engine.get(req.params.id, req.clientSession.id));
      res.json({ success: true });
    })
  );
  app.delete(
    `${API}/executions/:id`,
    route(async (req, res) => {
      await engine.remove(engine.get(req.params.id, req.clientSession.id));
      res.json({ success: true });
    })
  );
  app.get(
    `${API}/executions/:id/report`,
    route((req, res) => {
      const job = engine.get(req.params.id, req.clientSession.id);
      const results = job.results.map(
        ({ name, iteration, status, duration, size, error, assertions, extractionErrors }) => ({
          name,
          iteration,
          status,
          duration,
          size,
          error,
          assertions: assertions.map(({ name: title, passed }) => ({ name: title, passed })),
          extractionErrors
        })
      );
      res
        .attachment('api-client-report.json')
        .json({ schemaVersion: 1, state: job.state, progress: job.progress, results });
    })
  );
  app.get(
    `${API}/downloads/:id`,
    route((req, res) => {
      const file = engine.files.get(req.params.id, req.clientSession.id);
      check(!file.upload, '上传文件不可作为结果下载');
      res.attachment(file.name || 'response.bin').type('application/octet-stream').sendFile(file.path);
    })
  );
  app.delete(
    `${API}/uploads/:id`,
    route(async (req, res) => {
      const file = engine.files.get(req.params.id, req.clientSession.id);
      check(file.upload, '不是上传文件');
      await engine.files.remove(file.id);
      res.json({ success: true });
    })
  );
  app.get(
    `${API}/cookies`,
    route(async (req, res) => res.json((await req.clientSession.jar.serialize()).cookies))
  );
  app.post(
    `${API}/cookies`,
    route(async (req, res) => {
      check(typeof req.body.url === 'string' && /^https?:\/\//.test(req.body.url), 'Cookie 需要 HTTP/HTTPS URL');
      try {
        await req.clientSession.jar.setCookie(req.body.cookie, req.body.url);
      } catch {
        throw fail('Cookie 格式或目标 URL 无效');
      }
      res.json({ success: true });
    })
  );
  app.delete(
    `${API}/cookies`,
    route(async (req, res) => {
      await req.clientSession.jar.removeAllCookies();
      res.json({ success: true });
    })
  );
  app.use((req, res) => res.status(404).json({ error: '页面或 API 不存在' }));
  app.use((error, req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
    res.status(status).json({
      error:
        status === 500
          ? '操作失败，请检查工作区权限或文件格式'
          : error.type === 'entity.too.large'
            ? '请求内容超过限制'
            : error.message
    });
  });
  async function removeSession(session) {
    sessions.delete(session.id);
    for (const job of engine.jobs.values()) if (job.owner === session.id) await engine.remove(job);
    for (const file of engine.files.files.values()) if (file.owner === session.id) await engine.files.remove(file.id);
  }
  const sessionCleanup = setInterval(() => {
    for (const session of sessions.values())
      if (Date.now() - session.time > 12 * 3600000) removeSession(session).catch(() => {});
    for (const [key, attempt] of attempts) if (Date.now() - attempt.time > 60000) attempts.delete(key);
  }, 60000);
  sessionCleanup.unref();
  return {
    app,
    server,
    engine,
    workspace,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      clearInterval(sessionCleanup);
      const closing = new Promise(resolve => {
        if (!server.listening) return resolve();
        server.close(resolve);
        server.closeAllConnections?.();
      });
      await engine.close();
      await closing;
      sessions.clear();
    }
  };
}
async function openBrowser(url) {
  const result = await openPathInFileManager(url);
  if (!result.ok && !process.env.SILENT) console.warn(`无法自动打开浏览器，请访问 ${url}`);
}
async function start() {
  const client = createClientServer();
  try {
    const address = await client.listen(Number(process.env.PORT ?? 8090));
    if (!process.env.SILENT) {
      console.info('API Client available on:');
      getServerUrls(address.port).forEach(url => console.info(`    ${url}`));
    }
    if (process.env.OPEN_API_OVERVIEW) await openBrowser(`http://127.0.0.1:${address.port}`);
  } catch (error) {
    await client.close();
    throw error;
  }
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    client.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return client;
}
module.exports = { createClientServer, start };
