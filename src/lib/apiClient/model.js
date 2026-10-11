const crypto = require('crypto');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const LIMITS = { request: 20 * 1024 * 1024, response: 50 * 1024 * 1024, preview: 1024 * 1024, disk: 256 * 1024 * 1024 };
const sensitive = /authorization|cookie|password|token|secret|api[-_]?key/i;
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function check(value, message, status = 400) {
  if (!value) throw fail(message, status);
}
function safeObject(value, depth = 0) {
  check(depth < 60, '数据嵌套过深');
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), '不允许的对象字段');
    safeObject(value[key], depth + 1);
  }
}
function entries(value = []) {
  check(Array.isArray(value) && value.length <= 2000, '参数必须是列表（最多 2000 项）');
  return value.map(row => {
    check(row && typeof row.key === 'string' && typeof row.value === 'string', '参数需要字符串 key/value');
    return { ...row, enabled: row.enabled !== false };
  });
}
function request(value) {
  check(value && typeof value === 'object', '请求不能为空');
  safeObject(value);
  check(METHODS.includes(value.method), '不支持的 HTTP 方法');
  check(typeof value.url === 'string' && value.url.length <= 32768, 'URL 无效或过长');
  const body = value.body || { type: 'none' };
  check(['none', 'json', 'text', 'xml', 'form', 'multipart', 'binary'].includes(body.type), '不支持的正文类型');
  const settings = { timeout: 30000, redirects: true, verifyTls: true, cookies: true, ...value.settings };
  check(
    Number.isInteger(settings.timeout) && settings.timeout >= 1000 && settings.timeout <= 300000,
    '超时必须为 1000–300000 毫秒'
  );
  for (const key of ['redirects', 'verifyTls', 'cookies'])
    check(typeof settings[key] === 'boolean', `设置 ${key} 必须是布尔值`);
  const auth = value.auth || { type: 'inherit' };
  check(['inherit', 'none', 'basic', 'bearer', 'apiKey'].includes(auth.type), '不支持的认证方式');
  if (auth.type === 'apiKey') check(auth.in === undefined || ['header', 'query'].includes(auth.in), 'API Key 位置无效');
  for (const key of ['username', 'password', 'token', 'key', 'value'])
    check(auth[key] === undefined || typeof auth[key] === 'string', `认证 ${key} 必须是字符串`);
  if (body.type === 'form' || body.type === 'multipart') entries(body.fields || []);
  if (body.text !== undefined) check(typeof body.text === 'string', '正文必须是字符串');
  for (const key of ['assertions', 'extractors'])
    check(value[key] === undefined || (Array.isArray(value[key]) && value[key].length <= 100), `${key} 最多 100 项`);
  for (const rule of value.assertions || []) {
    check(
      rule && typeof rule === 'object' && ['status', 'header', 'json', 'time'].includes(rule.source),
      '断言来源无效'
    );
    check(['exists', 'equals', 'contains', 'type', 'lessThan'].includes(rule.op), '断言操作无效');
  }
  for (const rule of value.extractors || []) {
    check(
      rule && typeof rule.name === 'string' && rule.name && ['json', 'header'].includes(rule.source),
      '变量提取规则无效'
    );
  }
  return {
    ...value,
    id: value.id || crypto.randomUUID(),
    name: String(value.name || '新请求').slice(0, 200),
    headers: entries(value.headers),
    query: entries(value.query),
    body,
    auth,
    settings,
    assertions: value.assertions || [],
    extractors: value.extractors || []
  };
}
function resource(kind, value) {
  safeObject(value);
  check(value && typeof value.name === 'string' && value.name.trim(), '名称不能为空');
  check(value.schemaVersion === undefined || value.schemaVersion === 1, '不支持的 schemaVersion');
  const result = { ...value, schemaVersion: 1, variables: entries(value.variables) };
  if (kind === 'collections') {
    if (value.auth) result.auth = request({ method: 'GET', url: '', auth: value.auth }).auth;
    let count = 0;
    const ids = new Set();
    const visit = (items, depth = 0) => {
      check(Array.isArray(items) && depth <= 20, '集合目录无效或过深');
      return items.map(item => {
        check(++count <= 10000, '集合最多 10000 个条目');
        const id = item.id || crypto.randomUUID();
        check(typeof id === 'string' && !ids.has(id), '条目 ID 必须唯一');
        ids.add(id);
        return item.type === 'folder'
          ? { id, type: 'folder', name: String(item.name || '目录'), items: visit(item.items || [], depth + 1) }
          : request({ ...item, id });
      });
    };
    result.items = visit(value.items || []);
  }
  return result;
}
function variables(...groups) {
  const result = Object.create(null);
  for (const group of groups) {
    if (Array.isArray(group))
      for (const row of group) {
        if (row.enabled !== false) result[row.key] = row.value;
      }
    else if (group && typeof group === 'object') Object.assign(result, group);
  }
  return result;
}
function interpolate(value, vars, seen = []) {
  if (typeof value === 'string')
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
      check(Object.hasOwn(vars, key) && vars[key] !== undefined, `未定义变量: ${key}`);
      check(!seen.includes(key) && seen.length < 20, `变量循环引用: ${key}`);
      return interpolate(String(vars[key]), vars, [...seen, key]);
    });
  if (Array.isArray(value)) return value.map(row => interpolate(row, vars, seen));
  if (value && typeof value === 'object') {
    if (value.enabled === false) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, vars, seen)]));
  }
  return value;
}
function pointer(value, path) {
  if (path === '') return value;
  check(typeof path === 'string' && path.startsWith('/'), 'JSON Pointer 必须以 / 开始');
  for (const key of path
    .slice(1)
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function evaluate(rules, result, json) {
  const select = rule => {
    if (rule.source === 'status') return result.status;
    if (rule.source === 'time') return result.duration;
    if (rule.source === 'header')
      return result.headers.find(row => row.key.toLowerCase() === String(rule.path).toLowerCase())?.value;
    if (rule.source === 'json') return pointer(json, rule.path);
    throw fail('不支持的断言来源');
  };
  const assertions = (rules.assertions || []).map(rule => {
    try {
      const actual = select(rule);
      let passed;
      switch (rule.op) {
        case 'exists':
          passed = actual !== undefined;
          break;
        case 'equals':
          passed = JSON.stringify(actual) === JSON.stringify(rule.value);
          break;
        case 'contains':
          passed = (typeof actual === 'string' || Array.isArray(actual)) && actual.includes(rule.value);
          break;
        case 'type':
          passed = (Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual) === rule.value;
          break;
        case 'lessThan':
          passed = typeof actual === 'number' && actual < Number(rule.value);
          break;
        default:
          throw fail('不支持的断言操作');
      }
      return { name: rule.name || `${rule.source} ${rule.path || ''} ${rule.op}`, passed, actual };
    } catch (error) {
      return { name: rule.name || '断言', passed: false, error: error.message };
    }
  });
  const extracted = Object.create(null);
  const errors = [];
  for (const rule of rules.extractors || []) {
    try {
      check(
        typeof rule.name === 'string' && rule.name && !['__proto__', 'constructor', 'prototype'].includes(rule.name),
        '提取变量名无效'
      );
      check(['header', 'json'].includes(rule.source), '提取仅支持 header/json');
      const value = select(rule);
      check(value !== undefined, `提取失败: ${rule.name}`);
      extracted[rule.name] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { assertions, extracted, extractionErrors: errors };
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (['uploadId', 'revision'].includes(key)) continue;
    if (key === 'url' && typeof item === 'string') {
      output[key] = item.replace(/([?&])([^=&]+)=([^&#]*)/g, (whole, separator, name, val) => {
        try {
          return sensitive.test(decodeURIComponent(name)) && !/\{\{[^{}]+\}\}/.test(decodeURIComponent(val))
            ? `${separator}${name}=`
            : whole;
        } catch {
          return whole;
        }
      });
      continue;
    }
    const isSecret =
      (key === 'value' && (value.secret || sensitive.test(value.key || ''))) ||
      ['password', 'token', 'username'].includes(key) ||
      (key === 'value' && value.type === 'apiKey');
    output[key] = isSecret && typeof item === 'string' && !/\{\{[^{}]+\}\}/.test(item) ? '' : redact(item);
  }
  return output;
}
function flatten(items) {
  return items.flatMap(item => (item.type === 'folder' ? flatten(item.items) : [item]));
}
module.exports = {
  METHODS,
  LIMITS,
  sensitive,
  fail,
  check,
  safeObject,
  entries,
  request,
  resource,
  variables,
  interpolate,
  pointer,
  evaluate,
  redact,
  flatten
};
