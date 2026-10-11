const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const crypto = require('crypto');
const { check, fail, resource, redact } = require('./model');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

class Workspace {
  constructor(root) {
    this.root = path.resolve(root);
    this.id = hash(this.root);
  }
  async directory(kind, create = false) {
    check(['collections', 'environments'].includes(kind), '资源类型无效');
    if (create) await fs.mkdir(this.root, { recursive: true });
    const rootStat = await fs.lstat(this.root);
    check(rootStat.isDirectory() && !rootStat.isSymbolicLink(), '工作区不能是符号链接', 403);
    try {
      const file = path.join(this.root, 'workspace.json');
      const metadata = await fs.lstat(file);
      check(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size < 65536, '工作区元数据无效');
      check(JSON.parse(await fs.readFile(file, 'utf8')).schemaVersion === 1, '不支持的工作区 schemaVersion');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const dir = path.join(this.root, kind);
    if (create) await fs.mkdir(dir, { recursive: true });
    const stat = await fs.lstat(dir);
    check(stat.isDirectory() && !stat.isSymbolicLink(), '工作区子目录不能是符号链接');
    return dir;
  }
  async read(kind, id) {
    check(uuid.test(id), '资源 ID 无效');
    const dir = await this.directory(kind);
    const file = path.join(dir, `${id}.json`);
    const stat = await fs.lstat(file);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 20 * 1024 * 1024, '工作区文件无效或过大');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let text;
    try {
      check((await handle.stat()).size <= 20 * 1024 * 1024, '工作区文件过大');
      text = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    return { ...resource(kind, JSON.parse(text)), id, revision: hash(text) };
  }
  async list(kind) {
    let dir;
    try {
      dir = await this.directory(kind);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const names = await fs.readdir(dir);
    const rows = [];
    for (const name of names.filter(name => uuid.test(name.slice(0, -5)) && name.endsWith('.json')))
      rows.push(await this.read(kind, name.slice(0, -5)));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  async write(kind, id, value, revision, remove = false) {
    check(uuid.test(id), '资源 ID 无效');
    const data = remove ? null : { ...redact(resource(kind, value)), id };
    const dir = await this.directory(kind, true);
    const lock = path.join(this.root, '.write-lock');
    try {
      await fs.mkdir(lock);
    } catch (error) {
      if (error.code === 'EEXIST') throw fail('工作区正在写入；请稍后重试（异常退出后可手动移除 .write-lock）', 409);
      throw error;
    }
    const temp = path.join(dir, `.${crypto.randomUUID()}.tmp`);
    try {
      let current = null;
      try {
        current = await this.read(kind, id);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      check((current?.revision || null) === (revision || null), '文件已被其他窗口或外部工具修改，请重新加载后保存');
      const file = path.join(dir, `${id}.json`);
      if (remove) {
        check(current, '资源不存在');
        await fs.unlink(file);
        return { id };
      }
      const text = `${JSON.stringify(data, null, 2)}\n`;
      check(Buffer.byteLength(text) <= 20 * 1024 * 1024, '集合文件超过 20 MiB');
      await fs.writeFile(temp, text, { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, file);
      const metadata = path.join(this.root, 'workspace.json');
      try {
        await fs.writeFile(metadata, JSON.stringify({ schemaVersion: 1 }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      return { ...data, revision: hash(text) };
    } catch (error) {
      if (error.message.startsWith('文件已被')) error.status = 409;
      throw error;
    } finally {
      await fs.rm(temp, { force: true });
      await fs.rmdir(lock);
    }
  }
}
module.exports = { Workspace };
