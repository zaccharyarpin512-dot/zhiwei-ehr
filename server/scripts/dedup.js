const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password: 'postgres', database: 'zhiwei_dev' });
  await c.connect();
  const keep = (await c.query("SELECT MIN(id) k FROM assessment_task WHERE name='Q4绩效考核'")).rows[0].k;
  await c.query('DELETE FROM record_indicator WHERE record_id IN (SELECT id FROM assessment_record WHERE task_id IN (SELECT id FROM assessment_task WHERE name=$1 AND id<>$2))', ['Q4绩效考核', keep]);
  await c.query('DELETE FROM assessment_record WHERE task_id IN (SELECT id FROM assessment_task WHERE name=$1 AND id<>$2)', ['Q4绩效考核', keep]);
  await c.query('DELETE FROM assessment_task WHERE name=$1 AND id<>$2', ['Q4绩效考核', keep]);
  await c.query('DELETE FROM scheme a USING scheme b WHERE a.name=b.name AND a.id>b.id');
  await c.query('DELETE FROM work_task a USING work_task b WHERE a.title=b.title AND a.id>b.id');
  await c.query('DELETE FROM indicator a USING indicator b WHERE a.name=b.name AND a.id>b.id');
  console.log('dedup-ok');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
