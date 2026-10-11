const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { Worker } = require('worker_threads');
const { CookieJar } = require('tough-cookie');
const { responseFilename } = require('./download');
const { isManagedHeader } = require('./headers');
const { LIMITS, fail, check, request, interpolate, variables, redact, sensitive } = require('./model');

class TemporaryFiles {
  constructor() {
    this.files = new Map();
    this.bytes = 0;
    this.ready = fsp.mkdtemp(path.join(os.tmpdir(), 'mock-api-client-')).then(dir => {
      this.dir = dir;
      return dir;
    });
  }
  async create(owner) {
    await this.ready;
    check(this.files.size < 500, '临时文件数量已达上限');
    const id = crypto.randomUUID();
    const file = { id, owner, path: path.join(this.dir, id), size: 0, time: Date.now() };
    this.files.set(id, file);
    return file;
  }
  add(file, size) {
    if (this.bytes + size > LIMITS.disk) throw fail('临时存储超过 256 MiB，请清理结果后重试', 413);
    file.size += size;
    this.bytes += size;
  }
  get(id, owner) {
    const file = this.files.get(id);
    if (!file || file.owner !== owner) throw fail('临时文件不存在或已过期', 404);
    return file;
  }
  async remove(id) {
    const file = this.files.get(id);
    if (!file) return;
    this.files.delete(id);
    this.bytes -= file.size;
    await fsp.rm(file.path, { force: true });
  }
  async close() {
    await this.ready;
    await fsp.rm(this.dir, { recursive: true, force: true });
    this.files.clear();
    this.bytes = 0;
  }
}
function target(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail('请输入完整的 HTTP/HTTPS URL');
  }
  check(
    ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
    '仅支持 HTTP/HTTPS；请在认证面板设置凭据'
  );
  url.hash = '';
  return url;
}
function headerRows(raw) {
  const result = [];
  for (let i = 0; i < raw.length; i += 2) result.push({ key: raw[i], value: raw[i + 1] });
  return result;
}
function outgoingHeaders(rows) {
  const headers = Object.create(null);
  for (const row of rows.filter(row => row.enabled !== false)) {
    try {
      http.validateHeaderName(row.key);
      http.validateHeaderValue(row.key, row.value);
    } catch {
      throw fail('请求头名称或值无效，请检查 Headers');
    }
    const key = row.key.toLowerCase();
    check(!isManagedHeader(key), `请求头 ${row.key} 由客户端管理`);
    if (headers[key]) headers[key] = [].concat(headers[key], row.value);
    else headers[key] = row.value;
  }
  return headers;
}
async function bodyBuffer(body, headers, files, owner) {
  const setType = value => {
    if (!headers['content-type']) headers['content-type'] = value;
  };
  if (body.type === 'none') return null;
  if (body.type === 'binary') return fsp.readFile(files.get(body.uploadId, owner).path);
  if (body.type === 'multipart') {
    const boundary = `----MockClient${crypto.randomBytes(16).toString('hex')}`;
    headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
    const chunks = [];
    let size = 0;
    const append = chunk => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      check(size <= LIMITS.request, '请求正文超过 20 MiB');
      chunks.push(data);
    };
    for (const row of (body.fields || []).filter(row => row.enabled !== false)) {
      check(!/[\r\n"]/.test(row.key), '表单字段名无效');
      append(`--${boundary}\r\nContent-Disposition: form-data; name="${row.key}"`);
      if (row.uploadId || row.file) {
        const file = files.get(row.uploadId, owner);
        append(
          `; filename="${String(file.name || 'file').replace(/[\r\n"\\]/g, '_')}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        );
        append(await fsp.readFile(file.path));
      } else {
        append('\r\n\r\n');
        append(row.value);
      }
      append('\r\n');
    }
    append(`--${boundary}--\r\n`);
    return Buffer.concat(chunks);
  }
  if (body.type === 'form') {
    setType('application/x-www-form-urlencoded');
    return Buffer.from(
      new URLSearchParams(
        (body.fields || []).filter(row => row.enabled !== false).map(row => [row.key, row.value])
      ).toString()
    );
  }
  if (body.type === 'json') {
    try {
      JSON.parse(body.text || '');
    } catch {
      throw fail('JSON 正文格式无效');
    }
  }
  setType(
    body.type === 'json' ? 'application/json' : body.type === 'xml' ? 'application/xml' : 'text/plain; charset=utf-8'
  );
  return Buffer.from(body.text || '');
}
function addAuth(auth, headers, url) {
  if (!auth || ['none', 'inherit'].includes(auth.type)) return;
  const put = (key, value) => {
    check(!headers[key.toLowerCase()], `认证与请求头 ${key} 冲突`);
    headers[key.toLowerCase()] = value;
  };
  if (auth.type === 'basic')
    put('authorization', `Basic ${Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64')}`);
  if (auth.type === 'bearer') put('authorization', `Bearer ${auth.token || ''}`);
  if (auth.type === 'apiKey') {
    check(typeof auth.key === 'string' && auth.key, 'API Key 名称不能为空');
    if (auth.in === 'query') {
      check(!url.searchParams.has(auth.key), 'API Key 与 Query 参数冲突');
      url.searchParams.append(auth.key, auth.value || '');
    } else put(auth.key, auth.value || '');
  }
}
function assess(file, rules, result, signal) {
  if (!rules.assertions.length && !rules.extractors.length)
    return Promise.resolve({ assertions: [], extracted: {}, extractionErrors: [] });
  // Parsing a large response must not block other requests or cancellation.
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'assertionWorker.js'), {
      workerData: { file: file.path, rules, result },
      resourceLimits: { maxOldGenerationSizeMb: 192 }
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(fail('断言处理超时'));
    }, 10000);
    const abort = () => {
      worker.terminate();
      reject(fail('已取消'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    worker.once('message', value => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(value);
    });
    worker.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (code) reject(fail('断言处理资源限制'));
    });
  });
}
class Engine {
  constructor() {
    this.files = new TemporaryFiles();
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 16,
      maxFreeSockets: 4,
      maxTotalSockets: 32,
      timeout: 10000
    });
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 16,
      maxFreeSockets: 4,
      maxTotalSockets: 32,
      timeout: 10000
    });
    this.jobs = new Map();
    this.queue = [];
    this.active = 0;
    this.activeOwners = new Map();
    this.closed = false;
    this.cleanup = setInterval(() => this.expire().catch(() => {}), 60000);
    this.cleanup.unref();
  }
  submit(owner, input, jar = new CookieJar()) {
    check(!this.closed, '服务正在关闭');
    if (this.queue.length >= 100 || this.jobs.size >= 300) throw fail('任务队列已满，请清理历史结果后重试', 429);
    const job = {
      id: crypto.randomUUID(),
      owner,
      state: 'queued',
      created: Date.now(),
      controller: new AbortController(),
      results: []
    };
    this.jobs.set(job.id, job);
    this.queue.push({ job, input, jar });
    this.drain();
    return job;
  }
  drain() {
    if (this.closed) return;
    while (this.active < 16) {
      const index = this.queue.findIndex(({ job }) => (this.activeOwners.get(job.owner) || 0) < 4);
      if (index < 0) return;
      const [{ job, input, jar }] = this.queue.splice(index, 1);
      this.active++;
      this.activeOwners.set(job.owner, (this.activeOwners.get(job.owner) || 0) + 1);
      job.promise = this.run(job, input, jar).finally(() => {
        this.active--;
        const remaining = this.activeOwners.get(job.owner) - 1;
        if (remaining) this.activeOwners.set(job.owner, remaining);
        else this.activeOwners.delete(job.owner);
        this.drain();
      });
    }
  }
  get(id, owner) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) throw fail('执行任务不存在', 404);
    return job;
  }
  view(job, after = 0) {
    return {
      executionId: job.id,
      state: job.state,
      resultCount: job.results.length,
      results: job.results.slice(after),
      error: job.error,
      progress: job.progress
    };
  }
  cancel(job) {
    job.controller.abort();
    if (job.state === 'queued') {
      this.queue = this.queue.filter(item => item.job !== job);
      job.state = 'cancelled';
    }
  }
  async run(job, input, sessionJar) {
    job.state = 'running';
    try {
      const items = input.requests || [input.request];
      check(Array.isArray(items) && items.length > 0 && items.length <= 1000, '每次执行需要 1–1000 个请求');
      const iterations = input.iterations ?? 1;
      const delay = input.delay ?? 0;
      check(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100, '迭代次数为 1–100');
      check(Number.isInteger(delay) && delay >= 0 && delay <= 30000, '间隔为 0–30000 毫秒');
      check(items.length * iterations <= 1000, '单次运行最多 1000 次请求');
      const jar = input.requests ? await sessionJar.clone() : sessionJar;
      const vars = variables(input.collectionVariables, input.environmentVariables, input.secrets);
      job.progress = { completed: 0, total: items.length * iterations };
      for (let n = 0; n < iterations; n++)
        for (const item of items) {
          if (job.controller.signal.aborted) throw fail('已取消');
          let result;
          try {
            const resolved = interpolate(request(item), vars);
            if (resolved.auth.type === 'inherit') resolved.auth = interpolate(input.auth || { type: 'none' }, vars);
            result = await this.execute(resolved, job.owner, jar, job.controller.signal);
            Object.assign(vars, result.extracted);
            delete result.extracted;
          } catch (error) {
            if (job.controller.signal.aborted) throw error;
            result = {
              error: error.status ? error.message : '网络请求失败',
              code: error.code || 'REQUEST_FAILED',
              assertions: []
            };
          }
          result.name = item.name || '请求';
          result.iteration = n + 1;
          job.results.push(result);
          job.progress.completed++;
          if (
            (result.error || result.extractionErrors?.length || result.assertions.some(row => !row.passed)) &&
            input.stopOnFailure
          ) {
            job.state = 'failed';
            return;
          }
          if (delay && job.progress.completed < job.progress.total)
            await new Promise((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(fail('已取消'));
              };
              const timer = setTimeout(() => {
                job.controller.signal.removeEventListener('abort', abort);
                resolve();
              }, delay);
              job.controller.signal.addEventListener('abort', abort, { once: true });
            });
        }
      job.state = 'completed';
    } catch (error) {
      job.state = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = error.status ? error.message : '请求执行失败';
    }
  }
  async execute(input, owner, jar, signal) {
    let url = target(input.url);
    for (const row of input.query.filter(row => row.enabled !== false)) url.searchParams.append(row.key, row.value);
    let headers = outgoingHeaders(input.headers);
    addAuth(input.auth, headers, url);
    let body = await bodyBuffer(input.body, headers, this.files, owner);
    check(!body || body.length <= LIMITS.request, '请求正文超过 20 MiB');
    check(!['GET', 'HEAD'].includes(input.method) || !body?.length, 'GET/HEAD 不发送正文');
    let method = input.method;
    const started = Date.now();
    const redirects = [];
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), input.settings.timeout);
    let output;
    let activeResponse;
    try {
      for (let hop = 0; hop <= 10; hop++) {
        const currentHeaders = { ...headers };
        if (input.settings.cookies && !currentHeaders.cookie) {
          const cookie = await jar.getCookieString(url.href);
          if (cookie) currentHeaders.cookie = cookie;
        }
        if (body) currentHeaders['content-length'] = String(body.length);
        const response = await new Promise((resolve, reject) => {
          const transport = url.protocol === 'https:' ? https : http;
          const req = transport.request(
            url,
            {
              method,
              headers: currentHeaders,
              agent: url.protocol === 'https:' ? this.httpsAgent : this.httpAgent,
              rejectUnauthorized: input.settings.verifyTls,
              signal: controller.signal
            },
            resolve
          );
          req.on('error', reject);
          req.end(body);
        });
        activeResponse = response;
        // Invalid cookies from the target are ignored, never attributed to the workbench origin.
        if (input.settings.cookies)
          for (const cookie of response.headers['set-cookie'] || [])
            await jar.setCookie(cookie, url.href, { ignoreError: true });
        if (
          input.settings.redirects &&
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location
        ) {
          response.destroy();
          check(hop < 10, '重定向超过 10 次');
          const next = target(new URL(response.headers.location, url).href);
          check(!(url.protocol === 'https:' && next.protocol === 'http:'), '拒绝 HTTPS 降级重定向');
          redirects.push({ status: response.statusCode, url: url.href });
          if (next.origin !== url.origin) {
            headers = Object.fromEntries(
              Object.entries(headers).filter(
                ([key]) => !sensitive.test(key) && key !== String(input.auth.key || '').toLowerCase()
              )
            );
            if (input.auth.type === 'apiKey' && input.auth.in === 'query') next.searchParams.delete(input.auth.key);
          }
          if (
            (response.statusCode === 303 && method !== 'HEAD') ||
            ([301, 302].includes(response.statusCode) && method === 'POST')
          ) {
            method = 'GET';
            body = null;
            delete headers['content-type'];
          }
          url = next;
          continue;
        }
        output = await this.files.create(owner);
        output.name = responseFilename(response.headers);
        let wireSize = 0;
        let decodedSize = 0;
        const preview = [];
        let previewSize = 0;
        const wire = new Transform({
          transform(chunk, encoding, callback) {
            wireSize += chunk.length;
            callback(wireSize > LIMITS.response ? fail('响应传输超过 50 MiB', 413) : null, chunk);
          }
        });
        const engine = this;
        const decoded = new Transform({
          transform(chunk, encoding, callback) {
            try {
              decodedSize += chunk.length;
              check(decodedSize <= LIMITS.response, '解压响应超过 50 MiB');
              engine.files.add(output, chunk.length);
              if (previewSize < LIMITS.preview) {
                const part = chunk.subarray(0, LIMITS.preview - previewSize);
                preview.push(part);
                previewSize += part.length;
              }
              callback(null, chunk);
            } catch (error) {
              callback(error);
            }
          }
        });
        const encoding = response.headers['content-encoding'];
        const decompress =
          encoding === 'gzip'
            ? zlib.createGunzip()
            : encoding === 'deflate'
              ? zlib.createInflate()
              : encoding === 'br'
                ? zlib.createBrotliDecompress()
                : null;
        await pipeline(
          response,
          wire,
          ...(decompress && method !== 'HEAD' && response.statusCode !== 204 ? [decompress] : []),
          decoded,
          fs.createWriteStream(output.path, { flags: 'wx', mode: 0o600 }),
          { signal: controller.signal }
        );
        const result = {
          status: response.statusCode,
          statusText: response.statusMessage,
          duration: Date.now() - started,
          size: decodedSize,
          wireSize,
          url: url.href,
          redirects,
          headers: headerRows(response.rawHeaders),
          body: Buffer.concat(preview).toString('utf8'),
          truncated: decodedSize > LIMITS.preview,
          downloadId: output.id,
          downloadName: output.name,
          request: {
            method,
            url: url.href,
            headers: redact(Object.entries(currentHeaders).map(([key, value]) => ({ key, value: String(value) })))
          },
          tlsVerified: input.settings.verifyTls
        };
        Object.assign(
          result,
          await assess(
            output,
            input,
            { status: result.status, duration: result.duration, headers: result.headers },
            controller.signal
          )
        );
        return result;
      }
    } catch (error) {
      if (output) await this.files.remove(output.id);
      if (controller.signal.aborted) throw fail(signal.aborted ? '已取消' : '请求超时', 408);
      if (error.status) throw error;
      const safe = fail('网络连接或 TLS 验证失败', 502);
      safe.code = error.code;
      throw safe;
    } finally {
      for (const agent of [this.httpAgent, this.httpsAgent]) {
        const free = Object.values(agent.freeSockets).flat();
        for (const socket of free.slice(16)) socket.destroy();
      }
      activeResponse?.destroy();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async remove(job) {
    this.cancel(job);
    if (job.promise) await job.promise;
    for (const result of job.results) if (result.downloadId) await this.files.remove(result.downloadId);
    this.jobs.delete(job.id);
  }
  async expire() {
    const cutoff = Date.now() - 30 * 60000;
    for (const job of this.jobs.values())
      if (job.created < cutoff && !['running', 'queued'].includes(job.state)) await this.remove(job);
    for (const file of this.files.files.values())
      if (file.time < cutoff && file.upload) await this.files.remove(file.id);
  }
  async close() {
    this.closed = true;
    clearInterval(this.cleanup);
    for (const job of this.jobs.values()) this.cancel(job);
    await Promise.allSettled([...this.jobs.values()].map(job => job.promise));
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    await this.files.close();
  }
}
module.exports = { Engine, TemporaryFiles, target };
