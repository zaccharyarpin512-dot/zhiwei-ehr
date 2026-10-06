// 开发/测试用嵌入式 PostgreSQL 自管理封装。
// 背景：本项目路径含中文（GBK 字节），embedded-postgres 自动模式下 initdb 的
// post-bootstrap 步骤会因此 FATAL（0xd6 0xc7=「智」）。故将二进制拷贝到 ASCII
// 路径后自行驱动 initdb/postgres，环境变量同步净化。
// 数据源仍是真实 PostgreSQL 18 + Prisma，数据模型与 PRD 一致。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const HOME = os.homedir();
const DATA = path.join(HOME, '.zhiwei-ehr-pg');
const BINROOT = path.join(HOME, '.zhiwei-ehr-pg-bin');
const BINDIR = path.join(BINROOT, 'bin');
const PORT = 55432;
let child = null;

function findNativeDir() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, 'node_modules', '@embedded-postgres', 'windows-x64', 'native');
    if (fs.existsSync(path.join(cand, 'bin', 'initdb.exe'))) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 @embedded-postgres/windows-x64 二进制包');
}

function ensureBin() {
  if (fs.existsSync(path.join(BINDIR, 'initdb.exe'))) return;
  const src = findNativeDir();
  // 注意：本机 fs.cpSync 批量拷贝 exe 会使 node 硬崩溃（0xC0000409），改用独立进程 xcopy
  const r = spawnSync('xcopy', [src, BINROOT + '\\', '/E', '/I', '/Q', '/Y', '/H'], { encoding: 'utf8' });
  if (!fs.existsSync(path.join(BINDIR, 'initdb.exe'))) {
    throw new Error('PG 二进制拷贝失败: ' + (r.stderr || r.stdout || '').slice(-500));
  }
}

function cleanEnv() {
  const keep = ['SystemRoot', 'windir', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'COMPUTERNAME',
    'ComSpec', 'PATHEXT', 'OS', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN',
    'ALLUSERSPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER'];
  const env = {};
  for (const k of keep) { if (process.env[k]) env[k] = process.env[k]; }
  env.PATH = BINDIR + ';' + (process.env.PATH || '');
  env.LC_ALL = 'C';
  env.LANG = 'C';
  return env;
}

function waitReady(timeoutMs = 30000) {
  const { Client } = require('pg');
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
      try { await c.connect(); await c.end(); resolve(true); }
      catch (e) {
        if (Date.now() > deadline) return reject(e);
        setTimeout(attempt, 300);
      }
    };
    attempt();
  });
}

async function startPg() {
  ensureBin();
  // 已有实例在跑（如开发环境常驻 PG）→ 直接复用，避免端口冲突
  try { await waitReady(1500); return { port: PORT, reused: true }; } catch { /* 继续启动新实例 */ }
  const env = cleanEnv();
  const origCwd = process.cwd();
  process.chdir(HOME);
  const rmRf = (p) => spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', p], { stdio: 'ignore' });
  const del = (p) => spawnSync('cmd', ['/c', 'del', '/f', '/q', p], { stdio: 'ignore' });
  try {
    if (!fs.existsSync(path.join(DATA, 'PG_VERSION'))) {
      rmRf(DATA);
      const pwfile = path.join(HOME, '.zhiwei-ehr-pg.pw');
      fs.writeFileSync(pwfile, 'postgres\n');
      const r = spawnSync(path.join(BINDIR, 'initdb.exe'),
        ['--pgdata=' + DATA, '--auth=password', '--username=postgres', '--pwfile=' + pwfile,
         '--locale=C', '--lc-collate=C', '--lc-ctype=C', '--encoding=UTF8'],
        { env, cwd: HOME, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      del(pwfile);
      if (r.status !== 0) throw new Error('initdb 失败:\n' + (r.stderr || r.stdout || '').slice(-2000));
    }
    child = spawn(path.join(BINDIR, 'postgres.exe'),
      ['-D', DATA, '-p', String(PORT), '-h', '127.0.0.1', '-c', 'listen_addresses=127.0.0.1'],
      { env, cwd: HOME, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => console.error('postgres spawn error', e));
    await waitReady();
  } finally {
    process.chdir(origCwd);
  }
  return { port: PORT };
}

async function createDb(name) {
  const { Client } = require('pg');
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  await c.query(`CREATE DATABASE "${name}"`).catch(() => {});
  await c.end();
}

async function stopPg() {
  if (!child) return;
  await new Promise((resolve) => {
    try { spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' }).on('close', resolve); }
    catch { resolve(null); }
    setTimeout(resolve, 5000);
  });
  child = null;
}

module.exports = { startPg, stopPg, createDb, PORT };
