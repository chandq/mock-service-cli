let raw = '';
let parsed;
let text = '';
let lines = [];
function at(path) {
  let value = parsed;
  for (const key of path) value = value[key];
  return value;
}
self.onmessage = event => {
  const { id, action, value, path = [], query = '', start = 0, count = 200 } = event.data;
  try {
    let result;
    if (action === 'format') {
      result = JSON.stringify(JSON.parse(value), null, 2);
    } else if (action === 'load') {
      raw = value;
      parsed = undefined;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* Non-JSON responses remain plain text. */
      }
      text = parsed === undefined ? raw : JSON.stringify(parsed, null, 2);
      lines = text.split('\n');
      result = { json: parsed !== undefined, lines: lines.length, length: text.length };
    } else if (action === 'lines') {
      const all = value === 'raw' ? raw.split('\n') : lines;
      const rows = [];
      if (query) {
        for (let i = 0; i < all.length; i++)
          if (all[i].toLowerCase().includes(query.toLowerCase()))
            rows.push({ number: i + 1, text: all[i].slice(0, 20000) });
      }
      result = {
        total: query ? rows.length : all.length,
        rows: query
          ? rows.slice(start, start + count)
          : all.slice(start, start + count).map((line, i) => ({ number: start + i + 1, text: line.slice(0, 20000) }))
      };
      if (parsed !== undefined) for (const row of result.rows) row.parts = jsonParts(row.text);
    } else if (action === 'tree') {
      const node = at(path);
      if (node === null || typeof node !== 'object')
        result = { leaf: node === undefined ? '此响应不是 JSON' : JSON.stringify(node) };
      else {
        const keys = Object.keys(node);
        result = {
          total: keys.length,
          array: Array.isArray(node),
          entries: keys.slice(start, start + count).map(key => ({
            key,
            branch: node[key] !== null && typeof node[key] === 'object',
            summary:
              node[key] !== null && typeof node[key] === 'object'
                ? Array.isArray(node[key])
                  ? `[${node[key].length}]`
                  : `{${Object.keys(node[key]).length}}`
                : JSON.stringify(node[key])?.slice(0, 2000)
          }))
        };
      }
    } else if (action === 'copy') result = value === 'raw' ? raw : text;
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};

function jsonParts(line) {
  const parts = [];
  const tokens = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  let start = 0;
  for (const match of line.matchAll(tokens)) {
    if (match.index > start) parts.push({ kind: 'punctuation', text: line.slice(start, match.index) });
    parts.push({
      kind: match[1] ? (match[2] ? 'key' : 'string') : /^[\d-]/.test(match[0]) ? 'number' : 'keyword',
      text: match[0]
    });
    start = match.index + match[0].length;
  }
  if (start < line.length) parts.push({ kind: 'punctuation', text: line.slice(start) });
  return parts;
}
