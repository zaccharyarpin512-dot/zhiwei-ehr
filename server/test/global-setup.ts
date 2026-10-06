// Jest 全局启动：嵌入式 PostgreSQL（真实 PG，无需 Docker）+ prisma db push + generate
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startPg, createDb } from '../scripts/pg';

// 定位本地 prisma CLI（exports 限制 subpath，直接按磁盘路径解析）
function findPrismaCli(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到本地 prisma CLI');
}

export default async function globalSetup() {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/zhiwei_test';
  await startPg();
  await createDb('zhiwei_test');
  // 关键：子进程剥离 NODE_OPTIONS（本机 shell 注入了 safe-delete fs 钩子，会导致 prisma generate 失败）
  const childEnv: any = { ...process.env, DATABASE_URL: process.env.DATABASE_URL };
  delete childEnv.NODE_OPTIONS;
  const opts = { env: childEnv, stdio: 'pipe' as const, cwd: __dirname + '/..' };
  const cli = findPrismaCli();
  execFileSync(process.execPath, [cli, 'db', 'push', '--skip-generate'], opts);
  // 引擎已生成则跳过 generate——开发服务运行时会锁定 query_engine DLL，覆盖会 EPERM
  const engine = path.join(path.dirname(cli), '..', '..', '.prisma', 'client', 'query_engine-windows.dll.node');
  if (!fs.existsSync(engine)) {
    execFileSync(process.execPath, [cli, 'generate'], opts);
  }
}
