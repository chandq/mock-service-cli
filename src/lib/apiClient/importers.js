const crypto = require('crypto');
const YAML = require('yaml');
const { check, fail, safeObject, request, resource, redact, pointer, flatten } = require('./model');
const id = () => crypto.randomUUID();
const pair = (key, value, extra = {}) => ({ key: String(key), value: String(value ?? ''), enabled: true, ...extra });
function shellTokens(text) {
  const tokens = [];
  let token = '';
  let quote = '';
  let started = false;
  text = text.replace(/\\\r?\n/g, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\' && quote !== "'") {
      check(i + 1 < text.length, 'cURL 转义不完整');
      token += text[++i];
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
      started = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(token);
      token = '';
      started = false;
      continue;
    }
    check(!/[;|<>`]/.test(char) && !(char === '$' && text[i + 1] === '('), '仅允许单条 cURL，不支持 shell 命令');
    token += char;
    started = true;
  }
  check(!quote, 'cURL 引号未闭合');
  if (started) tokens.push(token);
  check(tokens.shift()?.toLowerCase() === 'curl', '请输入以 curl 开始的命令');
  return tokens;
}
function curl(text, warnings) {
  const tokens = shellTokens(text);
  const item = {
    id: id(),
    name: '导入的 cURL',
    method: 'GET',
    url: '',
    headers: [],
    query: [],
    body: { type: 'none' },
    auth: { type: 'none' }
  };
  let explicitMethod = false;
  for (let i = 0; i < tokens.length; i++) {
    let flag = tokens[i];
    let attached;
    if (flag.startsWith('--') && flag.includes('=')) {
      const index = flag.indexOf('=');
      attached = flag.slice(index + 1);
      flag = flag.slice(0, index);
    } else if (/^-[XHduF].+/.test(flag)) {
      attached = flag.slice(2);
      flag = flag.slice(0, 2);
    }
    const value = () => {
      const result = attached ?? tokens[++i];
      check(result !== undefined, `${flag} 缺少参数`);
      return result;
    };
    if (['-X', '--request'].includes(flag)) {
      item.method = value().toUpperCase();
      explicitMethod = true;
    } else if (['-H', '--header'].includes(flag)) {
      const line = value();
      const colon = line.indexOf(':');
      check(colon > 0, '请求头格式为 Name: Value');
      item.headers.push(pair(line.slice(0, colon), line.slice(colon + 1).trim()));
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(flag)) {
      const data = value();
      if (!explicitMethod) item.method = 'POST';
      if (data.startsWith('@') && flag !== '--data-raw') {
        item.body = { type: 'binary' };
        warnings.push('cURL 文件引用需要重新选择文件');
      } else if (flag === '--data-urlencode') {
        const index = data.indexOf('=');
        item.body = {
          type: 'form',
          fields: [
            ...(item.body.fields || []),
            pair(index < 0 ? data : data.slice(0, index), index < 0 ? '' : data.slice(index + 1))
          ]
        };
      } else item.body = { type: 'text', text: item.body.text ? `${item.body.text}&${data}` : data };
    } else if (['-F', '--form'].includes(flag)) {
      const data = value();
      const index = data.indexOf('=');
      check(index > 0, '表单格式为 key=value');
      const val = data.slice(index + 1);
      item.body = {
        type: 'multipart',
        fields: [
          ...(item.body.fields || []),
          pair(data.slice(0, index), val.startsWith('@') ? '' : val, { file: val.startsWith('@') })
        ]
      };
      if (val.startsWith('@')) warnings.push('multipart 文件需要重新选择');
      if (!explicitMethod) item.method = 'POST';
    } else if (['-u', '--user'].includes(flag)) {
      const data = value();
      const index = data.indexOf(':');
      item.auth = {
        type: 'basic',
        username: index < 0 ? data : data.slice(0, index),
        password: index < 0 ? '' : data.slice(index + 1)
      };
    } else if (['-b', '--cookie'].includes(flag)) {
      const val = value();
      if (val.includes('=')) item.headers.push(pair('Cookie', val));
      else warnings.push('不读取 cURL Cookie 文件');
    } else if (flag === '--url') item.url = value();
    else if (['-I', '--head'].includes(flag)) {
      item.method = 'HEAD';
      explicitMethod = true;
    } else if (['-k', '--insecure'].includes(flag)) {
      item.settings = { ...item.settings, verifyTls: false };
      warnings.push('此请求已关闭 TLS 验证');
    } else if (['-L', '--location'].includes(flag)) item.settings = { ...item.settings, redirects: true };
    else if (['--compressed', '-s', '--silent', '-S', '--show-error', '-v', '--verbose'].includes(flag))
      warnings.push(`忽略 cURL 选项 ${flag}`);
    else if (flag.startsWith('-')) throw fail(`不支持的 cURL 选项: ${flag}`);
    else {
      check(!item.url, '仅支持一个 URL');
      item.url = flag;
    }
  }
  check(item.url, 'cURL 缺少 URL');
  const type = item.headers.find(row => row.key.toLowerCase() === 'content-type')?.value || '';
  if (item.body.type === 'text' && type.includes('json')) item.body.type = 'json';
  return { id: id(), name: 'cURL 导入', variables: [], items: [request(item)] };
}
function postman(data, warnings) {
  check(data.info?.schema?.includes('/v2.1.0/'), '仅支持 Postman Collection v2.1');
  const vars = rows =>
    (rows || []).map(row => pair(row.key, row.value, { secret: row.type === 'secret', enabled: !row.disabled }));
  const auth = source => {
    if (!source) return { type: 'inherit' };
    const values = Object.fromEntries((source[source.type] || []).map(row => [row.key, row.value]));
    if (source.type === 'noauth') return { type: 'none' };
    if (source.type === 'basic')
      return { type: 'basic', username: values.username || '', password: values.password || '' };
    if (source.type === 'bearer') return { type: 'bearer', token: values.token || '' };
    if (source.type === 'apikey')
      return { type: 'apiKey', key: values.key || '', value: values.value || '', in: values.in || 'header' };
    warnings.push(`不支持 Postman 认证 ${source.type}`);
    return { type: 'none' };
  };
  const visit = (items, inheritedAuth) =>
    (items || []).map(item => {
      if (item.event?.length) warnings.push(`${item.name}: 脚本未导入`);
      if (item.variable?.length) warnings.push(`${item.name}: 文件夹/请求局部变量请移至集合或环境`);
      if (item.response?.length) warnings.push(`${item.name}: 已保存的响应示例未导入`);
      if (item.item)
        return {
          id: id(),
          name: item.name,
          type: 'folder',
          items: visit(item.item, item.auth ? auth(item.auth) : inheritedAuth)
        };
      const source = typeof item.request === 'string' ? { url: item.request } : item.request;
      check(source, 'Postman 请求缺失');
      const inputUrl = source.url;
      let url = typeof inputUrl === 'string' ? inputUrl : inputUrl?.raw || '';
      const query = typeof inputUrl === 'object' && inputUrl.query ? vars(inputUrl.query) : [];
      if (query.length) url = url.split('?')[0];
      const variables = typeof inputUrl === 'object' ? inputUrl.variable || [] : [];
      for (const row of variables) url = url.replace(`:${row.key}`, row.value || `{{${row.key}}}`);
      const body = { type: 'none' };
      if (source.body?.mode === 'raw')
        Object.assign(body, {
          type: source.body.options?.raw?.language === 'json' ? 'json' : 'text',
          text: source.body.raw || ''
        });
      else if (source.body?.mode === 'urlencoded')
        Object.assign(body, { type: 'form', fields: vars(source.body.urlencoded) });
      else if (source.body?.mode === 'formdata') {
        Object.assign(body, {
          type: 'multipart',
          fields: (source.body.formdata || []).map(row =>
            pair(row.key, row.type === 'file' ? '' : row.value, { file: row.type === 'file', enabled: !row.disabled })
          )
        });
        if (body.fields.some(row => row.file)) warnings.push(`${item.name}: 文件需要重新选择`);
      } else if (source.body?.mode === 'file') {
        body.type = 'binary';
        warnings.push(`${item.name}: 文件需要重新选择`);
      } else if (source.body?.mode) warnings.push(`${item.name}: 不支持 Body ${source.body.mode}`);
      if (
        source.body?.options?.raw?.language &&
        !['json', 'text', 'xml', 'html'].includes(source.body.options.raw.language)
      )
        warnings.push(`${item.name}: Body 语言已作为纯文本导入`);
      if (source.event?.length) warnings.push(`${item.name}: 请求脚本未导入`);
      if (source.protocolProfileBehavior || item.protocolProfileBehavior)
        warnings.push(`${item.name}: 协议扩展设置未导入`);
      return request({
        id: id(),
        name: item.name,
        method: source.method || 'GET',
        url,
        query,
        headers: vars(source.header),
        body,
        auth: source.auth ? auth(source.auth) : inheritedAuth
      });
    });
  if (data.event?.length) warnings.push('集合脚本未导入');
  if (/\{\{\$/.test(JSON.stringify(data))) warnings.push('Postman 动态变量不执行，请替换为环境变量');
  return {
    id: id(),
    name: data.info.name || 'Postman 导入',
    variables: vars(data.variable),
    auth: auth(data.auth),
    items: visit(data.item, auth(data.auth))
  };
}
function openapi(data, warnings) {
  check(/^3\.[01]\./.test(data.openapi || ''), '仅支持 OpenAPI 3.0/3.1');
  const ref = (value, visited = new Set()) => {
    if (!value?.$ref) return value || {};
    if (!value.$ref.startsWith('#/')) {
      warnings.push(`外部引用未解析: ${value.$ref}`);
      return {};
    }
    if (visited.has(value.$ref)) {
      warnings.push(`循环引用未展开: ${value.$ref}`);
      return {};
    }
    visited.add(value.$ref);
    const found = pointer(data, value.$ref.slice(1));
    if (!found) warnings.push(`引用不存在: ${value.$ref}`);
    return ref(found, visited);
  };
  const example = (input, seen = new Set(), depth = 0) => {
    if (depth > 8 || (input?.$ref && seen.has(input.$ref))) return null;
    if (input?.$ref) {
      seen = new Set(seen);
      seen.add(input.$ref);
    }
    const schema = ref(input);
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (schema.enum?.length) return schema.enum[0];
    if (schema.type === 'object' || schema.properties)
      return Object.fromEntries(
        Object.entries(schema.properties || {}).map(([key, val]) => [key, example(val, seen, depth + 1)])
      );
    if (schema.type === 'array') return [example(schema.items, seen, depth + 1)];
    return schema.type === 'boolean' ? false : ['integer', 'number'].includes(schema.type) ? 0 : '';
  };
  const folders = new Map();
  const result = { id: id(), name: data.info?.title || 'OpenAPI 导入', variables: [], items: [] };
  for (const [route, pathValue] of Object.entries(data.paths || {})) {
    const pathItem = ref(pathValue);
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      if (!pathItem[method]) continue;
      const op = ref(pathItem[method]);
      const server = (op.servers || pathItem.servers || data.servers || [{ url: '{{baseUrl}}' }])[0];
      let base = server.url;
      for (const [key, val] of Object.entries(server.variables || {}))
        base = base.replace(`{${key}}`, val.default ?? `{{${key}}}`);
      if (!/^https?:\/\//.test(base) && !base.startsWith('{{')) {
        warnings.push('相对 server URL 需要设置 baseUrl');
        base = `{{baseUrl}}${base}`;
      }
      let url = base.replace(/\/$/, '') + route;
      const query = [];
      const headers = [];
      const params = new Map();
      for (const raw of [...(pathItem.parameters || []), ...(op.parameters || [])]) {
        const p = ref(raw);
        params.set(`${p.in}:${p.name}`, p);
      }
      for (const p of params.values()) {
        const val = p.example ?? example(p.schema);
        if (p.style && !['form', 'simple'].includes(p.style))
          warnings.push(`${op.operationId || route}: 参数 ${p.name} 的 ${p.style} 序列化需手动配置`);
        if (p.in === 'path')
          url = url.replace(`{${p.name}}`, val === '' ? `{{${p.name}}}` : encodeURIComponent(String(val)));
        else if (p.in === 'query') {
          if (val && typeof val === 'object' && !Array.isArray(val))
            warnings.push(`${route}: 对象参数 ${p.name} 的序列化需手动确认`);
          const values = Array.isArray(val) ? (p.explode === false ? [val.join(',')] : val) : [val];
          for (const v of values) query.push(pair(p.name, typeof v === 'object' ? JSON.stringify(v) : v));
        } else if (p.in === 'header') headers.push(pair(p.name, val));
        else if (p.in === 'cookie') warnings.push(`${route}: Cookie 参数请在 Cookie 面板配置`);
      }
      const content = ref(op.requestBody).content || {};
      const contentType = Object.keys(content).find(key => key.includes('json')) || Object.keys(content)[0];
      let body = { type: 'none' };
      if (contentType) {
        const media = ref(content[contentType]);
        const val = media.example ?? Object.values(media.examples || {}).map(ref)[0]?.value ?? example(media.schema);
        if (contentType.includes('json')) body = { type: 'json', text: JSON.stringify(val, null, 2) };
        else if (['multipart/form-data', 'application/x-www-form-urlencoded'].includes(contentType)) {
          body = {
            type: contentType.startsWith('multipart') ? 'multipart' : 'form',
            fields: Object.entries(val || {}).map(([key, value]) =>
              pair(key, value, { file: ref(media.schema).properties?.[key]?.format === 'binary' })
            )
          };
          if (body.fields.some(row => row.file)) warnings.push(`${route}: 文件需要重新选择`);
        } else body = { type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val) };
        if (body.type !== 'multipart') headers.push(pair('Content-Type', contentType));
        if (Object.keys(content).length > 1) warnings.push(`${route}: 已选择 ${contentType}，其他正文类型未导入`);
      }
      let auth = { type: 'none' };
      const security = op.security ?? data.security ?? [];
      if (security.length) {
        const names = Object.keys(security[0]);
        const scheme = ref(data.components?.securitySchemes?.[names[0]]);
        if (security.length > 1 || names.length > 1) warnings.push(`${route}: 多种认证要求需手动确认`);
        if (scheme.type === 'http' && scheme.scheme === 'basic')
          auth = { type: 'basic', username: '{{username}}', password: '{{password}}' };
        else if ((scheme.type === 'http' && scheme.scheme === 'bearer') || scheme.type === 'oauth2')
          auth = { type: 'bearer', token: '{{token}}' };
        else if (scheme.type === 'apiKey' && scheme.in !== 'cookie')
          auth = { type: 'apiKey', key: scheme.name, in: scheme.in, value: '{{apiKey}}' };
        else warnings.push(`${route}: 认证 ${scheme.type || names[0]} 需手动配置`);
        if (scheme.type === 'oauth2') warnings.push(`${route}: OAuth Token 需手动提供`);
      }
      const tag = op.tags?.[0] || '默认';
      if (!folders.has(tag)) {
        const folder = { id: id(), type: 'folder', name: tag, items: [] };
        folders.set(tag, folder);
        result.items.push(folder);
      }
      folders.get(tag).items.push(
        request({
          id: id(),
          name: op.summary || op.operationId || `${method.toUpperCase()} ${route}`,
          method: method.toUpperCase(),
          url,
          query,
          headers,
          body,
          auth
        })
      );
      if (op.callbacks || op.links) warnings.push(`${route}: callbacks/links 未导入`);
    }
  }
  if (data.webhooks) warnings.push('OpenAPI webhooks 未导入');
  return result;
}
function preview(format, text) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= 20 * 1024 * 1024, '导入内容超过 20 MiB');
  const warnings = [];
  let value;
  if (format === 'curl') value = curl(text, warnings);
  else {
    let data;
    try {
      data = YAML.parse(text, { maxAliasCount: 30, uniqueKeys: true });
    } catch {
      throw fail('JSON/YAML 格式无效');
    }
    safeObject(data);
    if (format === 'postman') value = postman(data, warnings);
    else if (format === 'openapi') value = openapi(data, warnings);
    else if (format === 'native') {
      check(data.schemaVersion === 1, '原生格式需要 schemaVersion: 1');
      value = { ...data, id: id() };
    } else throw fail('不支持的导入格式');
  }
  const clean = redact(resource('collections', value));
  if (JSON.stringify(clean) !== JSON.stringify(resource('collections', value)))
    warnings.push('明文认证与敏感字段已清空，请使用会话 Secret 变量重新填写');
  return { collection: clean, count: flatten(clean.items).length, warnings: [...new Set(warnings)] };
}
function exportCurl(input) {
  const value = redact(request(input));
  const quote = text => "'" + String(text).replace(/'/g, "'\\''") + "'";
  let url = value.url;
  const params = value.query
    .filter(row => row.enabled !== false)
    .map(
      row =>
        `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value).replace(/%7B/gi, '{').replace(/%7D/gi, '}')}`
    )
    .join('&');
  if (params) url += (url.includes('?') ? '&' : '?') + params;
  const parts = ['curl', '-X', value.method, quote(url)];
  for (const row of value.headers.filter(row => row.enabled !== false))
    parts.push('-H', quote(`${row.key}: ${row.value}`));
  if (value.auth.type === 'bearer') parts.push('-H', quote(`Authorization: Bearer ${value.auth.token || '{{token}}'}`));
  if (value.auth.type === 'basic')
    parts.push('-u', quote(`${value.auth.username || '{{username}}'}:${value.auth.password || '{{password}}'}`));
  if (value.auth.type === 'apiKey') {
    if (value.auth.in === 'query') {
      const separator = url.includes('?') ? '&' : '?';
      parts[3] = quote(`${url}${separator}${encodeURIComponent(value.auth.key)}=${value.auth.value || '{{apiKey}}'}`);
    } else parts.push('-H', quote(`${value.auth.key}: ${value.auth.value || '{{apiKey}}'}`));
  }
  if (['json', 'text', 'xml'].includes(value.body.type)) {
    if (!value.headers.some(row => row.key.toLowerCase() === 'content-type'))
      parts.push(
        '-H',
        quote(
          `Content-Type: ${value.body.type === 'json' ? 'application/json' : value.body.type === 'xml' ? 'application/xml' : 'text/plain'}`
        )
      );
    parts.push('--data-raw', quote(value.body.text || ''));
  }
  if (value.body.type === 'form')
    for (const row of (value.body.fields || []).filter(row => row.enabled !== false))
      parts.push('--data-urlencode', quote(`${row.key}=${row.value}`));
  if (value.body.type === 'multipart')
    for (const row of (value.body.fields || []).filter(row => row.enabled !== false))
      parts.push('-F', quote(`${row.key}=${row.file ? '@SELECT_FILE' : row.value}`));
  if (value.body.type === 'binary') parts.push('--data-binary', quote('@SELECT_FILE'));
  if (!value.settings.verifyTls) parts.push('--insecure');
  return parts.join(' ');
}
module.exports = { preview, exportCurl, shellTokens };
