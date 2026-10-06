// 开发用常驻嵌入式 PG（数据在 ~/.zhiwei-ehr-pg，与测试库共用实例不同库名）
const { startPg, stopPg, createDb, PORT } = require('./pg');
(async () => {
  await startPg();
  await createDb('zhiwei_dev');
  console.log('DEV-PG-READY on port', PORT);
  setInterval(() => {}, 3600000); // 保活
  process.on('SIGTERM', async () => { await stopPg(); process.exit(0); });
})().catch((e) => { console.error(e); process.exit(1); });
