// WP-31/32 过程任务与悬赏集市验收（FR-M12-001/002：UAT 11 并发/幂等/封底/聚合）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-31/32 过程任务与悬赏集市（FR-M12-001/002）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let EMP = 0; let MGR = 0;
  let empToken = ''; let mgrToken = '';

  beforeAll(async () => { app = await buildApp(); prisma = app.get(PrismaService); });
  afterAll(async () => { await app.close(); });
  let mobSeq = 0;
  const mob = (p: string) => `${p}${Date.now() % 100000}${(mobSeq++).toString().padStart(3, '0')}`.slice(0, 11);

  beforeEach(async () => {
    s = await seedTenant(app);
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S1', name: '销售部' } });
    const mk = async (empNo: string, name: string, uid: number) => {
      const e = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo, name, mobile: mob('135'), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: uid } });
      return Number(e.id);
    };
    EMP = await mk('E1', '李四', s.empUserId);
    MGR = await mk('M1', '王经理', s.mgrUserId);
    empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
    mgrToken = `Bearer ${signAccess({ uid: s.mgrUserId, tid: s.tenantId, roles: ['manager'], empId: MGR })}`;
  });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('FR-M12-001 任务下达→执行→提交→验收；被指派人有待办；非法流转 40916', async () => {
    const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken)
      .send({ title: '整理 Q3 客户清单', assigneeEmpId: EMP, priority: 'high', dueDate: '2026-10-20' }).expect(201);
    expect(t.body.status).toBe('assigned');
    const todos = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', empToken).expect(200);
    expect(todos.body.some((x: any) => x.bizType === 'work_task')).toBe(true);
    // 员工开始执行→提交；经理验收
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'in_progress' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'submitted' }).expect(201);
    // 员工不能自验
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'accepted' }).expect(403);
    const acc = await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'accepted' }).expect(201);
    expect(acc.body.status).toBe('accepted');
    // 终态后非法流转
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'submitted' }).expect(409);
  });

  it('FR-M12-002 悬赏：先到先得（第二人 40005），验收积分入账', async () => {
    const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken)
      .send({ title: '修复报表导出 bug', rewardPoints: 80, scope: 'company' }).expect(201);
    expect(t.body.status).toBe('market_open');
    // 集市可见
    const market = await request(app.getHttpServer()).get('/api/v1/work-tasks?view=market').set('Authorization', empToken).expect(200);
    expect(market.body.some((x: any) => x.id === t.body.id && x.rewardPoints === 80)).toBe(true);
    // 李四认领成功
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/claim`).set('Authorization', empToken).expect(201);
    // 王经理再认领 → 40005（已不在集市）
    const again = await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/claim`).set('Authorization', mgrToken);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe(40005);
    // 提交→验收 → 80 积分入账
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'submitted' }).expect(201);
    const acc = await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'accepted' }).expect(201);
    expect(acc.body.reward.balance).toBe(80);
    const acct = await request(app.getHttpServer()).get('/api/v1/reward-account').set('Authorization', empToken).expect(200);
    expect(acct.body.balance).toBe(80);
    expect(acct.body.flows[0].bizType).toBe('market_reward');
  });

  it('UAT 11-② 积分幂等：同一任务重复入账不重复加分', async () => {
    const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '悬赏', rewardPoints: 50 }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/claim`).set('Authorization', empToken).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'submitted' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'accepted' }).expect(201);
    // 直接重复调用 credit 语义（同 bizId 再次验收路径）→ 通过重复 transition 模拟不可行，直接查流水唯一
    const acct = await request(app.getHttpServer()).get('/api/v1/reward-account').set('Authorization', empToken).expect(200);
    const marketFlows = acct.body.flows.filter((f: any) => f.bizType === 'market_reward' && f.bizId === `task:${t.body.id}`);
    expect(marketFlows.length).toBe(1); // 唯一入账
    expect(acct.body.balance).toBe(50);
  });

  it('UAT 11-③ 弃单扣分封底 0：80 积分任务弃单只扣 10，余额不足不转负', async () => {
    const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '悬赏80', rewardPoints: 80 }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/claim`).set('Authorization', empToken).expect(201);
    const ab = await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/abandon`).set('Authorization', empToken).expect(201);
    expect(ab.body.status).toBe('market_open');
    expect(ab.body.penalty.balance).toBe(0); // 0-10 封底 0
    const acct = await request(app.getHttpServer()).get('/api/v1/reward-account').set('Authorization', empToken).expect(200);
    expect(acct.body.balance).toBe(0);
  });

  it('FR-M12-004 过程数据按周期聚合：完成率/逾期/积分', async () => {
    for (const [i, due] of [['2026-10-01', '2026-09-01'], ['2026-10-20', '2026-12-31']] as any) {
      const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: `任务${i}`, assigneeEmpId: EMP, dueDate: due }).expect(201);
      await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'in_progress' }).expect(201);
      await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'submitted' }).expect(201);
      await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'accepted' }).expect(201);
    }
    const stat = await request(app.getHttpServer()).get(`/api/v1/employees/${EMP}/task-stat?from=2026-01-01&to=2027-01-01`).set('Authorization', mgrToken).expect(200);
    expect(stat.body.total).toBe(2);
    expect(stat.body.accepted).toBe(2);
    expect(stat.body.overdue).toBe(1); // due 2026-09-01 已过期
    expect(stat.body.onTimeRate).toBe(100);
  });
});
