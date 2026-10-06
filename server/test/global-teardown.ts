// Jest 全局 teardown：停止嵌入式 PostgreSQL
export default async function globalTeardown() {
  const { stopPg } = require('../scripts/pg');
  await stopPg();
}
