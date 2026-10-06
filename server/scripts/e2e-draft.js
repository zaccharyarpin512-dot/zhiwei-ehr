// 端到端实测：草稿任务全流程 + 方案解锁闭环
// 解锁场景：草稿任务锁定方案 → 删除草稿任务 → 方案锁定但无引用 → 解锁 → 可删
const BASE = 'http://127.0.0.1:3000/api/v1';
async function j(path, opts = {}, token) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
(async () => {
  const login = await j('/auth/login', { method: 'POST', body: JSON.stringify({ mobile: '13900000001', password: 'Passw0rd!' }) });
  const T = login.body.accessToken;

  // 0. 新建测试方案（草稿）
  const sc = await j('/schemes', { method: 'POST', body: JSON.stringify({ name: 'e2e-scheme', mode: 'kpi', periodType: 'month', nodes: [{ nodeType: 'goal_setting', seq: 1 }, { nodeType: 'self_review', seq: 2 }], indicators: [] }) }, T);
  const sid = sc.body.id;
  console.log('0.建方案:', sc.status, 'id', sid);

  // 1. 建草稿任务（只选销售部 dept=2）
  const c = await j('/tasks', { method: 'POST', body: JSON.stringify({ schemeId: sid, name: 'e2e-draft', period: '2026-11', startDate: '2026-11-01', endDate: '2026-11-30', asDraft: true, scopeFilter: { deptIds: [2], empIds: [] } }) }, T);
  console.log('1.建草稿:', c.status, c.body.status, '考核单:', c.body.recordCount);
  const id = c.body.id;

  // 2. 改草稿
  const u = await j(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'e2e-draft-V2' }) }, T);
  console.log('2.改草稿:', u.status);

  // 3. 发布 → 只生成销售部员工（dept=2）的考核单
  const s = await j(`/tasks/${id}/start`, { method: 'POST' }, T);
  console.log('3.发布:', s.status, s.body.status, '考核单:', s.body.recordCount, '（只含销售部）');

  // 4. 已发布不能再改/删
  const u2 = await j(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'x' }) }, T);
  const d2 = await j(`/tasks/${id}`, { method: 'DELETE' }, T);
  console.log('4.已发布保护: PUT', u2.status, 'DELETE', d2.status);

  // 5. 解锁闭环：新草稿任务锁方案 → 删任务 → 解锁 → 删方案
  const c2 = await j('/tasks', { method: 'POST', body: JSON.stringify({ schemeId: sid, name: 'lock-me', period: '2026-12', startDate: '2026-12-01', endDate: '2026-12-31', asDraft: true }) }, T);
  const un = await j(`/schemes/${sid}/unlock`, { method: 'POST' }, T);
  console.log('5a.有引用时解锁(应409):', un.status, un.body?.code);
  await j(`/tasks/${c2.body.id}`, { method: 'DELETE' }, T);
  const un2 = await j(`/schemes/${sid}/unlock`, { method: 'POST' }, T);
  console.log('5b.删任务后解锁:', un2.status, un2.body?.status);
  const del = await j(`/schemes/${sid}`, { method: 'DELETE' }, T);
  console.log('5c.解锁后删方案:', del.status);
})().catch((e) => { console.error(e); process.exit(1); });
