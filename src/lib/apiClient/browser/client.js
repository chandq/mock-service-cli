/* API Client deliberately keeps credentials in memory, outside persisted UI state. */
(() => {
  const $ = selector => document.querySelector(selector);
  const id = () =>
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
          (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
        );
  const clone = value => JSON.parse(JSON.stringify(value));
  const sensitive = /authorization|cookie|password|token|secret|api[-_]?key/i;
  const state = {
    collections: [],
    environments: [],
    tabs: [],
    active: '',
    env: '',
    panel: 'query',
    responseView: 'body',
    history: [],
    sidebar: 'collections',
    collapsed: new Set(),
    secrets: {},
    environmentSecrets: {},
    collectionSecrets: {},
    token: '',
    currentResult: null,
    job: null,
    runner: null
  };
  let db;
  let config;
  let editor;
  let editorPromise;
  let toastTimer;
  let persistTimer;
  let rows = [];
  let responseGeneration = 0;
  const pending = new Map();
  let workerId = 0;
  const worker = new Worker('/worker.js');
  worker.onmessage = event => {
    const item = pending.get(event.data.id);
    if (!item) return;
    pending.delete(event.data.id);
    if (event.data.error) item.reject(new Error(event.data.error));
    else item.resolve(event.data.result);
  };
  const work = (action, data = {}) =>
    new Promise((resolve, reject) => {
      const key = ++workerId;
      pending.set(key, { resolve, reject });
      worker.postMessage({ id: key, action, ...data });
    });
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'checked' || key === 'disabled' || key === 'value') node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.filter(child => child !== null && child !== undefined));
    return node;
  }
  function button(text, action, className = '') {
    return el('button', { text, className, onclick: () => guard(action) });
  }
  function select(options, value, change, label) {
    const node = el('select', { 'aria-label': label || '选择', onchange: event => change(event.target.value) });
    for (const option of options)
      node.append(
        el('option', {
          value: Array.isArray(option) ? option[0] : option,
          text: Array.isArray(option) ? option[1] : option
        })
      );
    node.value = value;
    return node;
  }
  function input(value, change, placeholder = '', type = 'text') {
    return el('input', {
      value: value ?? '',
      type,
      placeholder,
      'aria-label': placeholder || '值',
      oninput: event => change(event.target.value)
    });
  }
  function notice(text, error = false) {
    return el('div', { className: `notice ${error ? 'error-notice' : ''}`, text });
  }
  function toast(text, error = false) {
    const node = $('#toast');
    node.textContent = text;
    node.className = error ? 'error' : '';
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 4500);
  }
  async function guard(action) {
    try {
      return await action();
    } catch (error) {
      toast(error.message, true);
    }
  }
  async function api(path, method = 'GET', data, extra = {}) {
    const response = await fetch(`/__api-client/api${path}`, {
      method,
      headers: {
        'X-Api-Client-Token': state.token,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extra
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    if (response.status === 401) {
      location.assign('/login');
      throw new Error('请重新登录');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败');
    return result;
  }
  function active() {
    return state.tabs.find(tab => tab.id === state.active);
  }
  function fresh() {
    return {
      id: id(),
      name: '新请求',
      method: 'GET',
      url: '',
      query: [],
      headers: [],
      body: { type: 'none', text: '', fields: [] },
      auth: { type: 'inherit' },
      assertions: [],
      extractors: [],
      settings: { timeout: 30000, redirects: true, verifyTls: true, cookies: true }
    };
  }
  function flatten(items, parent = null) {
    return items.flatMap(item => [{ item, parent }, ...(item.type === 'folder' ? flatten(item.items, item) : [])]);
  }
  function persistable(value) {
    if (Array.isArray(value)) return value.map(persistable);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === 'uploadId') continue;
      const secret =
        ['password', 'token', 'username'].includes(key) ||
        (key === 'value' && (value.secret || sensitive.test(value.key || '') || value.type === 'apiKey'));
      result[key] = secret && typeof val === 'string' && !/\{\{[^{}]+\}\}/.test(val) ? '' : persistable(val);
    }
    return result;
  }
  function secureRequest(value) {
    const result = clone(value);
    const keep = (obj, key, name) => {
      if (!obj[key] || /\{\{[^{}]+\}\}/.test(obj[key])) return;
      const variable = `secret_${result.id.replace(/-/g, '')}_${name.replace(/[^\w]/g, '_')}`;
      state.secrets[variable] = obj[key];
      obj[key] = `{{${variable}}}`;
    };
    for (const key of ['token', 'password', 'username']) keep(result.auth, key, key);
    if (result.auth.type === 'apiKey') keep(result.auth, 'value', 'apiKey');
    for (const group of [result.headers, result.query, result.body.fields || []])
      for (const row of group) if (row.secret || sensitive.test(row.key)) keep(row, 'value', row.key);
    return result;
  }
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!db || !config) return;
      const data = {
        tabs: state.tabs.map(tab => ({ ...tab, request: persistable(tab.request), result: undefined, job: undefined })),
        active: state.active,
        env: state.env,
        history: state.history.slice(0, 500),
        theme: $('#theme').value,
        left: document.documentElement.style.getPropertyValue('--left'),
        requestWidth: document.documentElement.style.getPropertyValue('--request')
      };
      try {
        db.transaction('ui', 'readwrite').objectStore('ui').put(data, config.workspaceId);
      } catch {
        toast('浏览器存储不可用，项目文件仍可保存', true);
      }
    }, 180);
  }
  async function loadUI() {
    db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('mock-service-api-client', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('ui');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const saved = await new Promise(resolve => {
      const read = db.transaction('ui').objectStore('ui').get(config.workspaceId);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => resolve(null);
    });
    if (!saved) return;
    state.tabs = saved.tabs || [];
    state.active = saved.active;
    state.env = saved.env;
    state.history = saved.history || [];
    $('#theme').value = saved.theme || 'system';
    applyTheme();
    if (saved.left) document.documentElement.style.setProperty('--left', saved.left);
    if (saved.requestWidth) document.documentElement.style.setProperty('--request', saved.requestWidth);
  }
  function applyTheme() {
    document.documentElement.dataset.theme =
      $('#theme').value === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : $('#theme').value;
  }
  function mark() {
    const tab = active();
    if (!tab) return;
    tab.dirty = true;
    $('#save-state').textContent = '有未保存更改';
    renderTabs();
    urlPreview();
    persist();
  }
  function openRequest(value, collectionId = '') {
    let tab = state.tabs.find(row => row.request.id === value.id && row.collectionId === collectionId);
    if (!tab) {
      tab = { id: id(), collectionId, request: clone(value), dirty: !collectionId };
      const parsed = splitQuery(tab.request.url);
      if (parsed.query.length) {
        tab.request.url = parsed.url;
        tab.request.query = [...parsed.query, ...tab.request.query];
      }
      state.tabs.push(tab);
    }
    state.active = tab.id;
    renderRequest();
    renderTree();
    persist();
  }
  function renderTabs() {
    $('#tabs').replaceChildren(
      ...state.tabs.map(tab => {
        const node = el(
          'button',
          {
            className: tab.id === state.active ? 'active' : '',
            role: 'tab',
            title: `${tab.request.method} ${tab.request.name}${tab.dirty ? '（未保存）' : ''}`,
            'aria-selected': String(tab.id === state.active),
            onclick: () => {
              state.active = tab.id;
              renderRequest();
              renderTree();
              persist();
            }
          },
          el('span', { className: `method-tag ${tab.request.method}`, text: tab.request.method }),
          el('span', { className: 'tab-title', text: `${tab.dirty ? '• ' : ''}${tab.request.name}` })
        );
        node.append(
          el('span', {
            className: 'tab-close',
            role: 'button',
            'aria-label': `关闭 ${tab.request.name}`,
            title: `关闭 ${tab.request.name}`,
            tabindex: '0',
            text: '×',
            onclick: event => {
              event.stopPropagation();
              closeTab(tab);
            },
            onkeydown: event => {
              if (event.key === 'Enter') {
                event.stopPropagation();
                closeTab(tab);
              }
            }
          })
        );
        return node;
      })
    );
    $('#tabs .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function closeTab(tab) {
    if (tab.dirty && !confirm('此请求尚未保存，确定关闭？')) return;
    state.tabs = state.tabs.filter(row => row !== tab);
    if (state.active === tab.id) state.active = state.tabs[0]?.id;
    if (!state.tabs.length) openRequest(fresh());
    else renderRequest();
    persist();
  }
  function buildRows() {
    const search = $('#search').value.toLowerCase().trim();
    rows = [];
    if (state.sidebar === 'history') {
      rows = state.history
        .filter(row => `${row.request.name} ${row.request.url}`.toLowerCase().includes(search))
        .map(row => ({
          history: row,
          name: `${row.status || 'ERR'} · ${row.request.name}`,
          method: row.request.method,
          depth: 0
        }));
      return;
    }
    const visit = (items, collection, depth) => {
      for (const item of items) {
        if (item.type === 'folder') {
          if (
            !search ||
            flatten(item.items).some(row => `${row.item.name} ${row.item.url || ''}`.toLowerCase().includes(search))
          )
            rows.push({ item, collection, name: item.name, depth, folder: true });
          if (search || !state.collapsed.has(item.id)) visit(item.items, collection, depth + 1);
        } else if (!search || `${item.name} ${item.url}`.toLowerCase().includes(search))
          rows.push({ item, collection, name: item.name, method: item.method, depth });
      }
    };
    for (const collection of state.collections) {
      if (
        search &&
        !flatten(collection.items).some(row => `${row.item.name} ${row.item.url || ''}`.toLowerCase().includes(search))
      )
        continue;
      rows.push({ collection, name: collection.name, depth: 0, folder: true });
      if (search || !state.collapsed.has(collection.id)) visit(collection.items, collection, 1);
    }
  }
  function renderTree() {
    buildRows();
    drawTree();
  }
  function drawTree() {
    const tree = $('#tree');
    const scroll = tree.scrollTop;
    const start = Math.max(0, Math.floor(scroll / 36) - 5);
    const end = Math.min(rows.length, start + Math.ceil(tree.clientHeight / 36) + 12);
    const spacer = el('div', { style: `height:${rows.length * 36}px;position:relative` });
    if (!rows.length)
      spacer.append(
        el('p', {
          className: 'hint',
          style: 'padding:16px',
          text:
            state.sidebar === 'history' ? '发送请求后，这里会显示历史记录。' : '还没有集合。创建一个，或导入已有接口。'
        })
      );
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const selected = row.item?.id === active()?.request.id;
      const node = el('div', {
        className: `tree-row${selected ? ' selected' : ''}`,
        role: 'treeitem',
        tabindex: '0',
        style: `position:absolute;top:${i * 36}px;left:0;right:0;padding-left:${12 + row.depth * 13}px`,
        'aria-label': row.name
      });
      const go = () => {
        if (row.history) openRequest({ ...clone(row.history.request), id: id() });
        else if (row.folder) {
          const key = row.item?.id || row.collection.id;
          if (state.collapsed.has(key)) state.collapsed.delete(key);
          else state.collapsed.add(key);
          renderTree();
        } else openRequest(row.item, row.collection.id);
      };
      node.addEventListener('click', go);
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter') go();
      });
      node.append(
        el('span', {
          className: row.method ? `method-tag ${row.method}` : 'muted',
          text: row.method || (state.collapsed.has(row.item?.id || row.collection?.id) ? '▸' : '▾')
        }),
        el('span', { className: 'row-name', text: row.name })
      );
      if (!row.history)
        node.append(
          el('button', {
            className: 'row-menu',
            text: '···',
            'aria-label': `管理 ${row.name}`,
            onclick: event => {
              event.stopPropagation();
              manageRow(row);
            }
          })
        );
      spacer.append(node);
    }
    tree.replaceChildren(spacer);
    tree.scrollTop = scroll;
  }
  function modal(title, content, actions = []) {
    $('#modal-title').textContent = title;
    $('#modal-body').replaceChildren(...(Array.isArray(content) ? content : [content]));
    $('#modal-actions').replaceChildren(...actions);
    if (!$('#modal').open) $('#modal').showModal();
  }
  const closeModal = () => $('#modal').close();
  function sealVariables(rows, scope) {
    for (const row of rows || []) {
      if ((row.secret || sensitive.test(row.key)) && row.value && !/\{\{[^{}]+\}\}/.test(row.value)) {
        scope[row.key] = row.value;
        row.value = '';
        row.secret = true;
      }
    }
  }
  async function saveCollection(collection) {
    sealVariables(collection.variables, (state.collectionSecrets[collection.id] ||= {}));
    const saved = await api(
      `/collections/${collection.id}`,
      'PUT',
      collection,
      collection.revision ? { 'If-Match': collection.revision } : {}
    );
    const index = state.collections.findIndex(row => row.id === saved.id);
    if (index < 0) state.collections.push(saved);
    else state.collections[index] = saved;
    renderTree();
    return saved;
  }
  function newCollection() {
    let name = '新集合';
    const field = input(
      name,
      value => {
        name = value;
      },
      '集合名称'
    );
    modal('新建集合', field, [
      button(
        '创建集合',
        async () => {
          const collection = await saveCollection({
            id: id(),
            schemaVersion: 1,
            name,
            items: [],
            variables: [],
            auth: { type: 'none' }
          });
          closeModal();
          openRequest(fresh(), collection.id);
          toast('集合已创建');
        },
        'primary'
      )
    ]);
  }
  function folderOptions(collection, excluded = new Set()) {
    return [
      ['', '集合根目录'],
      ...flatten(collection.items)
        .filter(row => row.item.type === 'folder' && !excluded.has(row.item.id))
        .map(row => [row.item.id, row.item.name])
    ];
  }
  function manageRow(row) {
    const collection = clone(row.collection);
    const original = row.item && flatten(collection.items).find(entry => entry.item.id === row.item.id);
    const item = original?.item || collection;
    const content = el('div');
    content.append(
      el(
        'label',
        { text: '名称' },
        input(
          item.name,
          value => {
            item.name = value;
          },
          '名称'
        )
      )
    );
    let destination = original?.parent?.id || '';
    if (original)
      content.append(
        el(
          'label',
          { text: '移动到目录' },
          select(
            folderOptions(collection, new Set([item.id, ...flatten(item.items || []).map(entry => entry.item.id)])),
            destination,
            value => {
              destination = value;
            },
            '目标目录'
          )
        )
      );
    else {
      content.append(el('h3', { text: '集合变量' }));
      content.append(
        variablesTable(
          collection.variables || (collection.variables = []),
          (state.collectionSecrets[collection.id] ||= {})
        )
      );
      content.append(
        el('h3', { text: '集合认证' }),
        authForm(collection.auth || (collection.auth = { type: 'none' }), () => {}, false)
      );
    }
    const persistRow = async () => {
      if (original && destination !== (original.parent?.id || '')) {
        const source = original.parent?.items || collection.items;
        source.splice(source.indexOf(item), 1);
        const target = destination
          ? flatten(collection.items).find(entry => entry.item.id === destination).item.items
          : collection.items;
        target.push(item);
      }
      if (!original) {
        const wrapper = secureRequest({ ...fresh(), id: collection.id, auth: collection.auth });
        collection.auth = wrapper.auth;
      }
      await saveCollection(collection);
      closeModal();
      toast('已保存');
    };
    const actions = [
      button(
        '删除',
        async () => {
          if (!confirm(`确定删除「${item.name}」？`)) return;
          if (original) {
            const source = original.parent?.items || collection.items;
            source.splice(source.indexOf(item), 1);
            await saveCollection(collection);
          } else {
            await api(`/collections/${collection.id}`, 'DELETE', undefined, { 'If-Match': collection.revision });
            state.collections = state.collections.filter(entry => entry.id !== collection.id);
          }
          closeModal();
          renderTree();
        },
        'danger'
      ),
      button('复制', async () => {
        const copy = clone(item);
        const reid = value => {
          value.id = id();
          if (value.items) value.items.forEach(reid);
        };
        reid(copy);
        copy.name += ' 副本';
        if (original) {
          (original.parent?.items || collection.items).push(copy);
          await saveCollection(collection);
        } else {
          delete copy.revision;
          await saveCollection(copy);
        }
        closeModal();
        toast('已复制');
      })
    ];
    if (original)
      for (const [label, offset] of [
        ['上移', -1],
        ['下移', 1]
      ])
        actions.push(
          button(label, async () => {
            const source = original.parent?.items || collection.items;
            const index = source.indexOf(item);
            const target = Math.max(0, Math.min(source.length - 1, index + offset));
            source.splice(index, 1);
            source.splice(target, 0, item);
            await saveCollection(collection);
            closeModal();
          })
        );
    if (!original || item.type === 'folder') {
      actions.push(
        button('＋ 请求', () => {
          closeModal();
          const req = fresh();
          req._folder = original ? item.id : '';
          openRequest(req, collection.id);
        })
      );
      actions.push(
        button('＋ 文件夹', async () => {
          const name = prompt('文件夹名称', '新文件夹');
          if (!name) return;
          (original ? item.items : collection.items).push({ id: id(), type: 'folder', name, items: [] });
          await saveCollection(collection);
          closeModal();
        })
      );
    }
    actions.push(button('保存', persistRow, 'primary'));
    modal(original ? '管理条目' : '集合设置', content, actions);
  }
  async function saveRequest() {
    const tab = active();
    if (!tab) return;
    const commit = async collectionId => {
      const source = state.collections.find(row => row.id === collectionId);
      if (!source) throw new Error('集合已删除，请选择其他集合');
      const collection = clone(source);
      const value = secureRequest(tab.request);
      const found = flatten(collection.items).find(row => row.item.id === value.id);
      if (found) {
        const items = found.parent?.items || collection.items;
        items[items.indexOf(found.item)] = value;
      } else {
        const folder = value._folder && flatten(collection.items).find(row => row.item.id === value._folder)?.item;
        delete value._folder;
        (folder?.items || collection.items).push(value);
      }
      await saveCollection(collection);
      tab.collectionId = collectionId;
      tab.request = value;
      tab.dirty = false;
      closeModal();
      renderRequest();
      persist();
      toast('请求已保存到项目');
    };
    if (tab.collectionId && state.collections.some(row => row.id === tab.collectionId)) return commit(tab.collectionId);
    let collectionId = state.collections[0]?.id;
    if (!collectionId) {
      const collection = await saveCollection({
        id: id(),
        schemaVersion: 1,
        name: '我的接口',
        items: [],
        variables: [],
        auth: { type: 'none' }
      });
      return commit(collection.id);
    }
    modal(
      '保存到集合',
      select(
        state.collections.map(row => [row.id, row.name]),
        collectionId,
        value => {
          collectionId = value;
        },
        '保存到集合'
      ),
      [button('保存', () => commit(collectionId), 'primary')]
    );
  }
  function splitQuery(value) {
    const index = value.indexOf('?');
    if (index < 0) return { url: value, query: [] };
    return {
      url: value.slice(0, index),
      query: [...new URLSearchParams(value.slice(index + 1))].map(([key, val]) => ({ key, value: val, enabled: true }))
    };
  }
  function requestUrl(req) {
    const query = (req.query || [])
      .filter(row => row.enabled !== false)
      .map(
        row =>
          `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value).replace(/%7B/gi, '{').replace(/%7D/gi, '}')}`
      )
      .join('&');
    return req.url + (query ? (req.url.includes('?') ? '&' : '?') + query : '');
  }
  function urlPreview() {
    const req = active()?.request;
    if (!req) return;
    $('#url-preview').textContent = requestUrl(req).replace(/\{\{([^{}]+)\}\}/g, (original, key) => {
      if (Object.hasOwn(state.secrets, key)) return '••••';
      const env = state.environments.find(row => row.id === state.env);
      const collection = state.collections.find(row => row.id === active().collectionId);
      const value = [...(collection?.variables || []), ...(env?.variables || [])]
        .filter(row => row.enabled !== false && row.key === key)
        .at(-1);
      return value?.secret ? '••••' : value?.value || original;
    });
  }
  function renderRequest() {
    const tab = active();
    if (!tab) return;
    $('#request-name').value = tab.request.name;
    $('#method').value = tab.request.method;
    $('#url').value = requestUrl(tab.request);
    $('#save-state').textContent = tab.dirty ? '有未保存更改' : '已保存到项目';
    renderTabs();
    renderPanel();
    urlPreview();
    showResult(tab.result || null);
    syncSend();
  }
  function kvTable(values, change, options = {}) {
    const wrapper = el('div');
    const render = () => {
      const table = el('table', { className: 'kv-table' });
      const head = el('tr');
      for (const name of ['', 'KEY', 'VALUE', ...(options.secret ? ['SECRET'] : []), ''])
        head.append(el('th', { text: name }));
      table.append(el('thead', {}, head));
      const body = el('tbody');
      for (const row of values) {
        const tr = el('tr');
        tr.append(
          el(
            'td',
            {},
            el('input', {
              type: 'checkbox',
              checked: row.enabled !== false,
              'aria-label': '启用参数',
              onchange: event => {
                row.enabled = event.target.checked;
                change();
              }
            })
          )
        );
        tr.append(
          el(
            'td',
            {},
            input(
              row.key,
              value => {
                row.key = value;
                change();
              },
              'Key'
            )
          )
        );
        const field = input(
          row.secret ? (options.secretValues || state.secrets)[row.key] || '' : row.value,
          value => {
            if (row.secret) (options.secretValues || state.secrets)[row.key] = value;
            else row.value = value;
            change();
          },
          row.file ? '选择文件 →' : 'Value',
          row.secret ? 'password' : 'text'
        );
        const td = el('td', {}, field);
        if (options.files) {
          td.append(
            button(row.file ? row.fileName || '选择文件' : '文本 → 文件', () => {
              if (!row.file) {
                row.file = true;
                render();
                change();
                return;
              }
              chooseFile(async file => {
                const uploaded = await upload(file);
                row.uploadId = uploaded.uploadId;
                row.fileName = file.name;
                change();
                render();
              });
            })
          );
          if (row.file)
            td.append(
              button('改为文本', () => {
                row.file = false;
                delete row.uploadId;
                change();
                render();
              })
            );
        }
        tr.append(td);
        if (options.secret)
          tr.append(
            el(
              'td',
              {},
              el('input', {
                type: 'checkbox',
                checked: Boolean(row.secret),
                'aria-label': 'Secret 变量',
                onchange: event => {
                  row.secret = event.target.checked;
                  if (row.secret) {
                    (options.secretValues || state.secrets)[row.key] = row.value;
                    row.value = '';
                  }
                  change();
                  render();
                }
              })
            )
          );
        tr.append(
          el(
            'td',
            {},
            button('×', () => {
              values.splice(values.indexOf(row), 1);
              change();
              render();
            })
          )
        );
        body.append(tr);
      }
      table.append(body);
      wrapper.replaceChildren(
        table,
        el(
          'div',
          { className: 'toolbar' },
          button('＋ 添加', () => {
            values.push({ key: '', value: '', enabled: true });
            change();
            render();
          }),
          button('批量粘贴', () => {
            const text = prompt('每行一个 key: value 或制表符分隔的键值');
            if (!text) return;
            for (const line of text.split('\n')) {
              const separator = line.includes('\t') ? '\t' : ':';
              const index = line.indexOf(separator);
              if (index > 0)
                values.push({ key: line.slice(0, index).trim(), value: line.slice(index + 1).trim(), enabled: true });
            }
            change();
            render();
          })
        )
      );
    };
    render();
    return wrapper;
  }
  function variablesTable(values, secretValues = state.secrets) {
    return kvTable(values, () => {}, { secret: true, secretValues });
  }
  function authForm(auth, change, inherit = true) {
    const wrapper = el('div');
    const render = () => {
      const types = [
        ...(inherit ? [['inherit', '继承集合认证']] : []),
        ['none', '无认证'],
        ['basic', 'Basic Auth'],
        ['bearer', 'Bearer Token'],
        ['apiKey', 'API Key']
      ];
      const grid = el('div', { className: 'form-grid' });
      grid.append(
        el('label', { text: '认证方式' }),
        select(
          types,
          auth.type,
          value => {
            auth.type = value;
            change();
            render();
          },
          '认证方式'
        )
      );
      const field = (key, name, secret = false) => {
        grid.append(
          el('label', { text: name }),
          input(
            auth[key] || '',
            value => {
              auth[key] = value;
              change();
            },
            secret ? `{{${key}}} 或会话凭据` : name,
            secret ? 'password' : 'text'
          )
        );
      };
      if (auth.type === 'basic') {
        field('username', '用户名', true);
        field('password', '密码', true);
      }
      if (auth.type === 'bearer') field('token', 'Token', true);
      if (auth.type === 'apiKey') {
        field('key', 'Key 名称');
        field('value', 'Key 值', true);
        grid.append(
          el('label', { text: '添加位置' }),
          select(
            [
              ['header', 'Header'],
              ['query', 'Query']
            ],
            auth.in || 'header',
            value => {
              auth.in = value;
              change();
            },
            'API Key 位置'
          )
        );
      }
      wrapper.replaceChildren(
        grid,
        el('p', {
          className: 'hint',
          text: '凭据仅在当前会话使用。保存请求时转换为 Secret 变量引用；重开页面后请在环境管理中重新填写。OAuth Token 可手动粘贴到 Bearer。'
        })
      );
    };
    render();
    return wrapper;
  }
  function renderPanel() {
    editor?.destroy();
    editor = null;
    const req = active().request;
    const content = $('#request-content');
    content.replaceChildren();
    document
      .querySelectorAll('#request-panels button')
      .forEach(node => node.classList.toggle('active', node.dataset.panel === state.panel));
    if (['query', 'headers'].includes(state.panel)) {
      content.append(
        el('div', {
          className: 'section-label',
          text: state.panel === 'query' ? 'QUERY PARAMETERS' : 'REQUEST HEADERS'
        }),
        kvTable(req[state.panel], () => {
          mark();
          if (state.panel === 'query') $('#url').value = requestUrl(req);
        }),
        el('p', { className: 'hint', text: '支持 {{变量名}}。取消勾选可暂时停用；同名参数将按顺序保留。' })
      );
    } else if (state.panel === 'body') {
      content.append(
        select(
          [
            ['none', '无正文'],
            ['json', 'JSON'],
            ['text', 'Text'],
            ['xml', 'XML'],
            ['form', 'x-www-form-urlencoded'],
            ['multipart', 'multipart/form-data'],
            ['binary', '二进制文件']
          ],
          req.body.type,
          value => {
            req.body.type = value;
            req.body.fields ||= [];
            mark();
            renderPanel();
          },
          '正文类型'
        )
      );
      if (['form', 'multipart'].includes(req.body.type))
        content.append(
          kvTable(req.body.fields || (req.body.fields = []), mark, { files: req.body.type === 'multipart' })
        );
      else if (req.body.type === 'binary')
        content.append(
          el(
            'div',
            { className: 'toolbar' },
            button(req.body.fileName || '选择文件（最大 20 MiB）', () =>
              chooseFile(async file => {
                const data = await upload(file);
                req.body.uploadId = data.uploadId;
                req.body.fileName = file.name;
                mark();
                renderPanel();
              })
            )
          )
        );
      else if (req.body.type !== 'none') {
        const host = el('div', { className: 'editor-host', style: 'margin-top:14px' });
        const textarea = el('textarea', {
          'aria-label': '请求正文',
          value: req.body.text || '',
          spellcheck: 'false',
          oninput: event => {
            req.body.text = event.target.value;
            mark();
          }
        });
        host.append(textarea);
        const tools = el('div', { className: 'toolbar' });
        if (req.body.type === 'json')
          tools.append(
            button('格式化 JSON', () =>
              guard(async () => {
                const before = req.body.text || '';
                const formatted = await work('format', { value: before });
                if (!host.isConnected || req.body.text !== before) return;
                if (editor) editor.replaceText(formatted);
                else {
                  textarea.value = formatted;
                  req.body.text = formatted;
                  mark();
                }
              })
            )
          );
        tools.append(button('查找 / 替换', () => editor?.search()));
        const hint = el('p', { className: 'hint', text: '正在加载正文编辑器…' });
        content.append(tools, host, hint);
        loadEditor()
          .then(() => {
            if (!host.isConnected || !window.createApiEditor) return;
            host.replaceChildren();
            editor = window.createApiEditor(
              host,
              req.body.text || '',
              value => {
                req.body.text = value;
                mark();
              },
              req.body.type
            );
            hint.textContent = `${req.body.type === 'text' ? '纯文本' : req.body.type.toUpperCase() + ' 语法高亮'} · 行号与折叠 · Tab 缩进 · Ctrl / ⌘ + F 查找`;
          })
          .catch(() => {
            hint.textContent = '编辑器加载失败，当前使用普通文本框；请重新构建服务并刷新页面。';
            editorPromise = null;
          });
      }
    } else if (state.panel === 'auth') content.append(authForm(req.auth, mark));
    else if (state.panel === 'tests') renderRules(content, req);
    else {
      const grid = el('div', { className: 'form-grid' });
      grid.append(
        el('label', { text: '超时（毫秒）' }),
        input(
          req.settings.timeout,
          value => {
            req.settings.timeout = Number(value);
            mark();
          },
          '1000–300000',
          'number'
        )
      );
      for (const [key, name] of [
        ['redirects', '自动跟随重定向'],
        ['verifyTls', '验证 TLS 证书'],
        ['cookies', '自动携带 Cookie']
      ])
        grid.append(
          el('label', { text: name }),
          el('input', {
            type: 'checkbox',
            checked: req.settings[key],
            'aria-label': name,
            onchange: event => {
              req.settings[key] = event.target.checked;
              mark();
              renderPanel();
            }
          })
        );
      content.append(grid);
      if (!req.settings.verifyTls) content.append(notice('此请求已关闭 TLS 证书验证。', true));
      content.append(
        el('p', { className: 'hint', text: '最多 10 次重定向；跨源跳转不携带原始凭据。请求失败不会自动重试。' })
      );
    }
  }
  function loadEditor() {
    if (!editorPromise)
      editorPromise = new Promise((resolve, reject) => {
        const script = el('script', { src: '/editor.js' });
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    return editorPromise;
  }
  function renderRules(content, req) {
    const assertions = el('div');
    const extractors = el('div');
    function draw() {
      assertions.replaceChildren(
        ...req.assertions.map(rule =>
          el(
            'div',
            { className: 'rule-row' },
            select(
              [
                ['status', '状态码'],
                ['header', '响应头'],
                ['json', 'JSON 字段'],
                ['time', '耗时']
              ],
              rule.source,
              value => {
                rule.source = value;
                mark();
                draw();
              },
              '断言来源'
            ),
            ...(['header', 'json'].includes(rule.source)
              ? [
                  input(
                    rule.path || '',
                    value => {
                      rule.path = value;
                      mark();
                    },
                    rule.source === 'json' ? '/data/id' : 'Header 名称'
                  )
                ]
              : []),
            select(
              [
                ['equals', '等于'],
                ['exists', '存在'],
                ['contains', '包含'],
                ['type', '类型'],
                ['lessThan', '小于']
              ],
              rule.op,
              value => {
                rule.op = value;
                mark();
              },
              '断言操作'
            ),
            input(
              typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value),
              value => {
                try {
                  rule.value = JSON.parse(value);
                } catch {
                  rule.value = value;
                }
                mark();
              },
              '期望值'
            ),
            button('×', () => {
              req.assertions.splice(req.assertions.indexOf(rule), 1);
              mark();
              draw();
            })
          )
        )
      );
      extractors.replaceChildren(
        ...req.extractors.map(rule =>
          el(
            'div',
            { className: 'rule-row' },
            input(
              rule.name,
              value => {
                rule.name = value;
                mark();
              },
              '变量名'
            ),
            select(
              [
                ['json', 'JSON Pointer'],
                ['header', '响应头']
              ],
              rule.source,
              value => {
                rule.source = value;
                mark();
              },
              '提取来源'
            ),
            input(
              rule.path,
              value => {
                rule.path = value;
                mark();
              },
              '/data/token'
            ),
            button('×', () => {
              req.extractors.splice(req.extractors.indexOf(rule), 1);
              mark();
              draw();
            })
          )
        )
      );
    }
    content.append(
      el('h3', { text: '响应断言' }),
      assertions,
      button('＋ 添加断言', () => {
        req.assertions.push({ source: 'status', op: 'equals', value: 200 });
        mark();
        draw();
      }),
      el('h3', { text: '提取运行时变量', style: 'margin-top:28px' }),
      extractors,
      button('＋ 提取变量', () => {
        req.extractors.push({ name: 'token', source: 'json', path: '/data/token' });
        mark();
        draw();
      }),
      el('p', {
        className: 'hint',
        text: '使用 JSON Pointer，例如 /data/0/id。提取值仅在本轮集合执行中生效；后续请求可引用 {{token}}。'
      })
    );
    draw();
  }
  function chooseFile(callback, accept = '') {
    const picker = el('input', { type: 'file', accept });
    picker.onchange = () => {
      if (picker.files[0]) guard(() => callback(picker.files[0]));
    };
    picker.click();
  }
  async function upload(file) {
    if (file.size > config.limits.request) throw new Error('文件超过 20 MiB');
    const response = await fetch('/__api-client/api/uploads', {
      method: 'POST',
      headers: {
        'X-Api-Client-Token': state.token,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name)
      },
      body: file
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    toast('文件已上传，仅在本次会话可用');
    return value;
  }
  function executionContext(collectionId) {
    const collection = state.collections.find(row => row.id === collectionId);
    const environment = state.environments.find(row => row.id === state.env);
    const resolveScope = (rows, secrets = {}) =>
      (rows || [])
        .filter(row => row.enabled !== false)
        .map(row => ({ ...row, value: row.secret ? secrets[row.key] : row.value }));
    return {
      collectionVariables: resolveScope(collection?.variables, state.collectionSecrets[collectionId]),
      environmentVariables: resolveScope(environment?.variables, state.environmentSecrets[state.env]),
      secrets: state.secrets,
      auth: collection?.auth || { type: 'none' }
    };
  }
  function syncSend() {
    const sending = Boolean(active()?.job);
    $('#send').disabled = sending;
    $('#send').textContent = sending ? '发送中…' : '发送 ↗';
    $('#cancel').hidden = !sending;
  }
  async function send() {
    const tab = active();
    if (tab.job) return;
    tab.request = secureRequest(tab.request);
    const data = await api('/executions', 'POST', { request: tab.request, ...executionContext(tab.collectionId) });
    tab.job = data.executionId;
    if (active() === tab) {
      syncSend();
      $('#response-content').replaceChildren(
        el(
          'div',
          { className: 'empty-state' },
          el('div', { className: 'loading-ring' }),
          el('h3', { text: '正在等待响应…' }),
          el('p', { text: '请求由本地服务发送，可随时取消。' })
        )
      );
    }
    try {
      const job = await poll(data.executionId);
      tab.result = job.results[0] || {
        error: job.error || (job.state === 'cancelled' ? '已取消' : '请求失败'),
        assertions: []
      };
      state.history.unshift({
        id: id(),
        time: Date.now(),
        request: persistable(tab.request),
        status: tab.result.status,
        duration: tab.result.duration
      });
      state.history = state.history.slice(0, 500);
      if (active() === tab) await showResult(tab.result);
      renderTree();
      persist();
    } finally {
      tab.job = null;
      syncSend();
    }
  }
  async function poll(executionId, progress) {
    let interval = 200;
    const results = [];
    for (;;) {
      const job = await api(`/executions/${executionId}?after=${results.length}`);
      results.push(...job.results);
      job.results = results;
      if (progress) progress(job);
      if (!['queued', 'running'].includes(job.state)) return job;
      await new Promise(resolve => setTimeout(resolve, interval));
      interval = Math.min(1000, interval + 100);
    }
  }
  async function showResult(result) {
    const generation = ++responseGeneration;
    state.currentResult = result;
    const metrics = $('#metrics');
    const content = $('#response-content');
    content.onscroll = null;
    if (!result) {
      metrics.replaceChildren(el('span', { className: 'muted', text: '准备就绪' }));
      content.replaceChildren(
        el(
          'div',
          { className: 'empty-state' },
          el('div', { className: 'empty-symbol', text: '↗' }),
          el('h3', { text: '从一个请求开始' }),
          el('p', { text: '输入接口地址或选择一个已保存请求。' })
        )
      );
      return;
    }
    if (result.error) {
      metrics.replaceChildren(el('span', { className: 'failure', text: result.error }));
      content.replaceChildren(notice(result.error, true));
      return;
    }
    metrics.replaceChildren(
      el('span', {
        className: `metric ${result.status < 400 ? 'success' : 'failure'}`,
        text: `${result.status} ${result.statusText || ''}`
      }),
      el('span', { className: 'metric', text: `${result.duration} ms` }),
      el('span', { className: 'metric', text: `${(result.size / 1024).toFixed(1)} KiB` })
    );
    $('#response-footer').textContent = result.truncated
      ? '预览已截断为 1 MiB；下载查看完整响应。'
      : result.tlsVerified === false
        ? '此请求未验证 TLS 证书'
        : `${(result.assertions || []).filter(row => row.passed).length}/${(result.assertions || []).length} 断言通过`;
    if (state.responseView === 'body') {
      await work('load', { value: result.body || '' });
      if (generation !== responseGeneration) return;
      if ($('#response-format').value === 'tree') {
        content.replaceChildren();
        await treeNode(content, [], generation);
      } else {
        content.scrollTop = 0;
        await renderResponseLines(generation);
        content.onscroll = () => guard(() => renderResponseLines(generation));
      }
    } else if (state.responseView === 'headers') {
      content.replaceChildren(
        ...result.headers.map(row =>
          el('div', { className: 'result-card' }, el('strong', { text: row.key }), el('pre', { text: row.value }))
        )
      );
    } else if (state.responseView === 'request') {
      content.replaceChildren(
        el(
          'div',
          { className: 'result-card' },
          el('strong', { text: `${result.request.method} ${result.url}` }),
          el('pre', {
            text: JSON.stringify(
              { headers: result.request.headers, redirects: result.redirects, tlsVerified: result.tlsVerified },
              null,
              2
            )
          })
        )
      );
    } else
      content.replaceChildren(
        ...(result.assertions || []).map(row =>
          el('div', {
            className: `result-card ${row.passed ? 'success' : 'failure'}`,
            text: `${row.passed ? '✓' : '×'} ${row.name}${row.error ? ` · ${row.error}` : ''}`
          })
        ),
        ...(result.extractionErrors || []).map(text => notice(text, true)),
        ...((result.assertions || []).length
          ? []
          : [el('p', { className: 'hint', text: '在请求 Tests 面板中添加断言。' })])
      );
  }
  async function renderResponseLines(generation) {
    const content = $('#response-content');
    const scroll = content.scrollTop;
    const start = Math.max(0, Math.floor(scroll / 21) - 5);
    const data = await work('lines', {
      value: $('#response-format').value,
      query: $('#response-search').value,
      start,
      count: Math.ceil(content.clientHeight / 21) + 15
    });
    if (generation !== responseGeneration) return;
    const wrap = el('div', { style: `height:${data.total * 21}px;position:relative;min-width:100%` });
    data.rows.forEach((row, i) =>
      wrap.append(
        el(
          'div',
          { className: 'response-line', style: `position:absolute;top:${(start + i) * 21}px` },
          el('span', { className: 'line-number', text: row.number }),
          ...(row.parts
            ? row.parts.map(part => el('span', { className: `syntax-${part.kind}`, text: part.text }))
            : [row.text])
        )
      )
    );
    content.replaceChildren(wrap);
    content.scrollTop = scroll;
  }
  async function treeNode(parent, path, generation, start = 0) {
    const data = await work('tree', { path, start, count: 100 });
    if (generation !== responseGeneration) return;
    if (data.leaf !== undefined) {
      parent.append(el('div', { className: 'json-leaf', text: data.leaf || '此响应不是 JSON' }));
      return;
    }
    for (const row of data.entries) {
      if (!row.branch) parent.append(el('div', { className: 'json-leaf', text: `${row.key}: ${row.summary}` }));
      else {
        const detail = el('details', { className: 'json-tree' }, el('summary', { text: `${row.key}: ${row.summary}` }));
        let loaded = false;
        detail.addEventListener('toggle', () => {
          if (detail.open && !loaded) {
            loaded = true;
            guard(() => treeNode(detail, [...path, row.key], generation));
          }
        });
        parent.append(detail);
      }
    }
    if (start + data.entries.length < data.total) {
      const more = button('加载更多节点', async () => {
        more.remove();
        await treeNode(parent, path, generation, start + 100);
      });
      parent.append(more);
    }
  }
  async function download(path, filename) {
    const response = await fetch(`/__api-client/api${path}`, { headers: { 'X-Api-Client-Token': state.token } });
    if (!response.ok) throw new Error('下载失败或结果已过期');
    saveBlob(await response.blob(), filename);
  }
  async function copyText(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    const area = el('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('浏览器不允许复制，请使用导出或下载');
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportRequest() {
    const tab = active();
    const collection = state.collections.find(row => row.id === tab.collectionId);
    modal('导出', el('p', { className: 'hint', text: '默认保留变量引用，敏感值不会写入导出文件。' }), [
      button('复制 cURL', async () => {
        const value = await api('/exports/curl', 'POST', secureRequest(tab.request));
        await copyText(value.text);
        toast('cURL 已复制');
        closeModal();
      }),
      button(
        '导出集合 JSON',
        () => {
          const data = collection || {
            schemaVersion: 1,
            name: tab.request.name,
            variables: [],
            items: [secureRequest(tab.request)]
          };
          saveBlob(
            new Blob([JSON.stringify(persistable(data), null, 2)], { type: 'application/json' }),
            `${data.name}.json`
          );
          closeModal();
        },
        'primary'
      )
    ]);
  }
  function importDialog() {
    let format = 'curl';
    let text = '';
    let report;
    const source = el('textarea', {
      placeholder: '粘贴 cURL、Postman Collection、OpenAPI 或原生 JSON…',
      'aria-label': '导入内容',
      oninput: event => {
        text = event.target.value;
        report = null;
      }
    });
    const result = el('div');
    const content = el(
      'div',
      {},
      el(
        'div',
        { className: 'toolbar' },
        select(
          [
            ['curl', 'cURL'],
            ['postman', 'Postman v2.1'],
            ['openapi', 'OpenAPI 3.0 / 3.1'],
            ['native', '原生 JSON']
          ],
          format,
          value => {
            format = value;
            report = null;
          },
          '导入格式'
        ),
        button('选择文件', () =>
          chooseFile(async file => {
            if (file.size > config.limits.request) throw new Error('文件超过 20 MiB');
            text = await file.text();
            source.value = text;
            report = null;
          }, '.json,.yaml,.yml,.txt')
        )
      ),
      source,
      result
    );
    const commit = button(
      '确认导入',
      async () => {
        if (!report) throw new Error('请先预览当前内容');
        await saveCollection(report.collection);
        closeModal();
        toast(`已导入 ${report.count} 个请求`);
      },
      'primary'
    );
    modal('导入接口', content, [
      button('预览兼容性', async () => {
        report = await api('/imports/preview', 'POST', { format, text });
        result.replaceChildren(
          notice(`「${report.collection.name}」包含 ${report.count} 个请求，将保存为新集合。`),
          ...report.warnings.map(message => notice(message))
        );
      }),
      commit
    ]);
  }
  function environmentsDialog() {
    let selected = state.env || state.environments[0]?.id || '';
    let draft;
    const content = el('div');
    const draw = () => {
      draft = clone(
        state.environments.find(row => row.id === selected) || {
          id: id(),
          name: '新环境',
          schemaVersion: 1,
          variables: []
        }
      );
      content.replaceChildren(
        select(
          [['', '＋ 新环境'], ...state.environments.map(row => [row.id, row.name])],
          selected,
          value => {
            selected = value;
            draw();
          },
          '编辑环境'
        ),
        el(
          'label',
          { text: '环境名称' },
          input(
            draft.name,
            value => {
              draft.name = value;
            },
            '环境名称'
          )
        ),
        variablesTable(draft.variables, (state.environmentSecrets[draft.id] ||= {})),
        el('p', {
          className: 'hint',
          text: 'Secret 值只保留在当前页面内存中。普通变量保存到项目文件，切勿填写真实密码。'
        })
      );
      const missing = new Set(Object.keys(state.secrets));
      const scan = value => {
        for (const match of JSON.stringify(value).matchAll(/\{\{([^{}]+)\}\}/g))
          if (match[1].startsWith('secret_')) missing.add(match[1]);
      };
      state.collections.forEach(scan);
      state.tabs.forEach(tab => scan(tab.request));
      if (missing.size) {
        content.append(el('h3', { text: '请求凭据（仅当前会话）' }));
        for (const key of missing)
          content.append(
            el(
              'label',
              { text: key },
              input(
                state.secrets[key] || '',
                value => {
                  state.secrets[key] = value;
                },
                '重新填写凭据',
                'password'
              )
            )
          );
      }
    };
    draw();
    modal('环境与会话凭据', content, [
      button('删除环境', async () => {
        if (!selected || !confirm('确定删除此环境？')) return;
        await api(`/environments/${draft.id}`, 'DELETE', undefined, { 'If-Match': draft.revision });
        state.environments = state.environments.filter(row => row.id !== draft.id);
        if (state.env === draft.id) state.env = '';
        renderEnvironments();
        closeModal();
      }),
      button('仅应用会话凭据', () => {
        closeModal();
        urlPreview();
        toast('会话凭据已更新');
      }),
      button(
        '保存并启用环境',
        async () => {
          sealVariables(draft.variables, (state.environmentSecrets[draft.id] ||= {}));
          const saved = await api(
            `/environments/${draft.id}`,
            'PUT',
            draft,
            draft.revision ? { 'If-Match': draft.revision } : {}
          );
          const index = state.environments.findIndex(row => row.id === saved.id);
          if (index < 0) state.environments.push(saved);
          else state.environments[index] = saved;
          state.env = saved.id;
          renderEnvironments();
          closeModal();
          persist();
          toast('环境已保存');
        },
        'primary'
      )
    ]);
  }
  function renderEnvironments() {
    $('#environment').replaceChildren(
      el('option', { value: '', text: '无环境' }),
      ...state.environments.map(row => el('option', { value: row.id, text: row.name }))
    );
    $('#environment').value = state.env;
    urlPreview();
  }
  async function cookiesDialog() {
    const cookies = await api('/cookies');
    let url = '';
    let value = '';
    const content = el(
      'div',
      {},
      el('p', {
        className: 'hint',
        text: 'Cookie 按域名、路径、Secure 和到期时间管理，仅用于目标接口。不会读取浏览器自身 Cookie。'
      }),
      ...cookies.map(cookie =>
        el(
          'div',
          { className: 'result-card' },
          el('strong', { text: `${cookie.domain}${cookie.path} · ${cookie.key}` }),
          el('pre', { text: `${cookie.value}\n${cookie.secure ? 'Secure · ' : ''}${cookie.expires || 'Session'}` })
        )
      ),
      el(
        'label',
        { text: '目标 URL' },
        input(
          url,
          text => {
            url = text;
          },
          'https://api.example.com'
        )
      ),
      el(
        'label',
        { text: '新增或更新 Cookie' },
        input(
          value,
          text => {
            value = text;
          },
          'session=abc; Path=/; Secure'
        )
      )
    );
    modal('Cookie 管理', content, [
      button('清除全部', async () => {
        await api('/cookies', 'DELETE');
        await cookiesDialog();
      }),
      button(
        '保存 Cookie',
        async () => {
          await api('/cookies', 'POST', { url, cookie: value });
          await cookiesDialog();
        },
        'primary'
      )
    ]);
  }
  function runnerDialog() {
    if (state.runner) {
      showRunner();
      return;
    }
    let collectionId = active()?.collectionId || state.collections[0]?.id;
    if (!collectionId) {
      toast('先创建并保存一个集合', true);
      return;
    }
    let iterations = 1;
    let delay = 0;
    let stopOnFailure = false;
    const selection = new Set();
    const requests = el('div');
    const draw = () => {
      selection.clear();
      const collection = state.collections.find(row => row.id === collectionId);
      requests.replaceChildren(
        ...flatten(collection.items)
          .filter(row => row.item.type !== 'folder')
          .map(({ item }) => {
            selection.add(item.id);
            return el(
              'label',
              { className: 'check-label' },
              el('input', {
                type: 'checkbox',
                checked: true,
                onchange: event => {
                  if (event.target.checked) selection.add(item.id);
                  else selection.delete(item.id);
                }
              }),
              `${item.method} ${item.name}`
            );
          })
      );
    };
    draw();
    const content = el(
      'div',
      {},
      select(
        state.collections.map(row => [row.id, row.name]),
        collectionId,
        value => {
          collectionId = value;
          draw();
        },
        '运行集合'
      ),
      el(
        'div',
        { className: 'toolbar' },
        el(
          'label',
          { text: '迭代次数' },
          input(
            iterations,
            value => {
              iterations = Number(value);
            },
            '1–100',
            'number'
          )
        ),
        el(
          'label',
          { text: '请求间隔（毫秒）' },
          input(
            delay,
            value => {
              delay = Number(value);
            },
            '0–30000',
            'number'
          )
        ),
        el(
          'label',
          { className: 'check-label' },
          el('input', {
            type: 'checkbox',
            onchange: event => {
              stopOnFailure = event.target.checked;
            }
          }),
          '失败后停止'
        )
      ),
      requests
    );
    modal('运行集合', content, [
      button(
        '开始运行',
        async () => {
          const collection = state.collections.find(row => row.id === collectionId);
          const selected = flatten(collection.items)
            .filter(row => selection.has(row.item.id))
            .map(row => row.item);
          if (!selected.length) throw new Error('至少选择一个请求');
          state.runner = await api('/executions', 'POST', {
            requests: selected,
            iterations,
            delay,
            stopOnFailure,
            ...executionContext(collectionId)
          });
          showRunner();
          const job = await poll(state.runner.executionId, progress => {
            state.runner = progress;
            if ($('#modal').open && $('#modal-title').textContent === '集合执行结果') showRunner();
          });
          state.runner = job;
          showRunner();
        },
        'primary'
      )
    ]);
  }
  function showRunner() {
    const job = state.runner;
    const content = el(
      'div',
      {},
      notice(`${job.state || 'queued'} · ${job.progress?.completed || 0} / ${job.progress?.total || '…'}`)
    );
    for (const result of job.results || [])
      content.append(
        el(
          'div',
          { className: 'result-card' },
          el('strong', { text: `${result.name} · 第 ${result.iteration} 轮 · ${result.status || result.error}` }),
          el('p', {
            className: 'hint',
            text: `${result.duration || 0} ms · ${(result.assertions || []).filter(row => row.passed).length}/${(result.assertions || []).length} 断言通过`
          }),
          button('查看响应', async () => {
            closeModal();
            await showResult(result);
          })
        )
      );
    if (job.error) content.append(notice(job.error, true));
    modal('集合执行结果', content, [
      button('取消执行', () => api(`/executions/${job.executionId}/cancel`, 'POST', {})),
      button('导出报告', () => download(`/executions/${job.executionId}/report`, 'api-client-report.json')),
      button('清理结果', async () => {
        await api(`/executions/${job.executionId}`, 'DELETE');
        state.runner = null;
        closeModal();
      })
    ]);
  }
  function setupSplitter(node, property, min, max, reversed = false) {
    node.addEventListener('pointerdown', event => {
      const start = event.clientX;
      const initial = reversed
        ? $('.request-pane').getBoundingClientRect().width
        : $('.sidebar').getBoundingClientRect().width;
      node.setPointerCapture(event.pointerId);
      const move = moveEvent =>
        document.documentElement.style.setProperty(
          property,
          `${Math.min(max, Math.max(min, initial + moveEvent.clientX - start))}px`
        );
      const up = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        persist();
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
    node.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const initial = reversed
        ? $('.request-pane').getBoundingClientRect().width
        : $('.sidebar').getBoundingClientRect().width;
      document.documentElement.style.setProperty(
        property,
        `${Math.min(max, Math.max(min, initial + (event.key === 'ArrowRight' ? 20 : -20)))}px`
      );
      persist();
    });
  }
  async function boot() {
    config = await api('/config');
    state.token = config.token;
    $('#workspace').textContent = config.workspaceName;
    [state.collections, state.environments] = await Promise.all([api('/collections'), api('/environments')]);
    try {
      await loadUI();
    } catch {
      toast('浏览器存储不可用，临时界面状态不会保存', true);
    }
    $('#search').addEventListener('input', renderTree);
    $('#tree').addEventListener('scroll', drawTree);
    $('#show-collections').onclick = () => {
      state.sidebar = 'collections';
      $('#show-collections').classList.add('active');
      $('#show-history').classList.remove('active');
      renderTree();
    };
    $('#show-history').onclick = () => {
      state.sidebar = 'history';
      $('#show-history').classList.add('active');
      $('#show-collections').classList.remove('active');
      renderTree();
    };
    $('#new-collection').onclick = newCollection;
    $('#new-request').onclick = () => openRequest(fresh());
    $('#request-name').oninput = event => {
      active().request.name = event.target.value;
      mark();
    };
    $('#method').onchange = event => {
      active().request.method = event.target.value;
      mark();
    };
    $('#url').oninput = event => {
      const parsed = splitQuery(event.target.value);
      active().request.url = parsed.url;
      active().request.query = parsed.query;
      mark();
      if (state.panel === 'query') renderPanel();
    };
    $('#request-panels').onclick = event => {
      if (!event.target.dataset.panel) return;
      state.panel = event.target.dataset.panel;
      renderPanel();
    };
    $('#response-panels').onclick = event => {
      if (!event.target.dataset.view) return;
      state.responseView = event.target.dataset.view;
      document
        .querySelectorAll('#response-panels button')
        .forEach(node => node.classList.toggle('active', node === event.target));
      guard(() => showResult(state.currentResult));
    };
    $('#response-format').onchange = () => guard(() => showResult(state.currentResult));
    let searchTimer;
    $('#response-search').oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => guard(() => showResult(state.currentResult)), 150);
    };
    $('#response-copy').onclick = () =>
      guard(async () => {
        if (!state.currentResult || state.currentResult.error) throw new Error('还没有可复制的响应');
        await copyText(await work('copy', { value: $('#response-format').value }));
        toast('响应已复制');
      });
    $('#response-download').onclick = () =>
      guard(async () => {
        if (!state.currentResult?.downloadId) throw new Error('还没有可下载的响应');
        await download(
          `/downloads/${state.currentResult.downloadId}`,
          state.currentResult.downloadName || 'response.bin'
        );
      });
    $('#send').onclick = () => guard(send);
    $('#cancel').onclick = () => guard(() => api(`/executions/${active().job}/cancel`, 'POST', {}));
    $('#save').onclick = () => guard(saveRequest);
    $('#export').onclick = () => guard(exportRequest);
    $('#import').onclick = importDialog;
    $('#environments').onclick = environmentsDialog;
    $('#environment').onchange = event => {
      state.env = event.target.value;
      urlPreview();
      persist();
    };
    $('#cookies').onclick = () => guard(cookiesDialog);
    $('#run').onclick = runnerDialog;
    $('#theme').onchange = () => {
      applyTheme();
      persist();
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    $('#logout').onclick = () =>
      guard(async () => {
        if (!confirm('退出并清除当前会话凭据和执行结果？')) return;
        await api('/session', 'DELETE');
        state.secrets = {};
        state.environmentSecrets = {};
        state.collectionSecrets = {};
        location.assign('/');
      });
    $('#modal-close').onclick = closeModal;
    const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
    $('#save kbd').textContent = `${modifier} S`;
    $('#search').placeholder = `搜索请求…  ${modifier} K`;
    $('#shortcuts').onclick = () =>
      modal('快捷键', [
        el('p', {
          className: 'hint',
          text: '页面获得焦点后可用；Mac 使用 ⌘，Windows / Linux 使用 Ctrl。打开弹窗时暂停工作台快捷键。'
        }),
        ...[
          ['发送当前请求', `${modifier} + Enter`],
          ['保存当前请求到项目', `${modifier} + S`],
          ['聚焦左侧请求搜索', `${modifier} + K`],
          ['正文内查找 / 替换（先点击编辑器）', `${modifier} + F`],
          ['正文撤销 / 重做', `${modifier} + Z / ${modifier} + Shift + Z`],
          ['正文缩进 / 取消缩进', 'Tab / Shift + Tab'],
          ['离开正文编辑器', '先按 Escape，再按 Tab'],
          ['关闭弹窗或正文查找栏', 'Escape']
        ].map(([label, keys]) =>
          el(
            'div',
            { className: 'result-card' },
            el('strong', { text: label }),
            el('div', {}, el('kbd', { text: keys }))
          )
        )
      ]);
    document.addEventListener(
      'keydown',
      event => {
        if (!(event.ctrlKey || event.metaKey) || $('#modal').open) return;
        const key = event.key.toLowerCase();
        if (!['enter', 's', 'k'].includes(key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (key === 'enter') guard(send);
        else if (key === 's') guard(saveRequest);
        else $('#search').focus();
      },
      { capture: true }
    );
    window.addEventListener('beforeunload', event => {
      if (state.tabs.some(tab => tab.dirty)) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    setupSplitter($('#left-split'), '--left', 180, 420);
    setupSplitter($('#right-split'), '--request', 320, 1000, true);
    if (!state.tabs.length) openRequest(fresh());
    else {
      if (!active()) state.active = state.tabs[0].id;
      renderRequest();
    }
    renderEnvironments();
    renderTree();
    applyTheme();
    document.body.dataset.ready = 'true';
  }
  guard(boot);
})();
