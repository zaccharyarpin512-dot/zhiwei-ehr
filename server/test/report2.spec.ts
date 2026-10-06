// WP-33 日报周报 + 考核对接验收（FR-M12-003/005：UAT 11-④ 封顶）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-33 日报周报与考核对接（FR-M12-003/005）', () => {
  let app: INestApplication;
  let s: any; let prisma: any;
  let EMP = 0; let MGR = 0; let empToken = ''; let mgrToken = '';
  beforeAll(async () => { app = await buildApp(); prisma = app.get(PrismaService); });
  afterAll(async () => { await app.close(); });
  let seq = 0;
  const mob = (p: string) => `${p}${Date.now() % 100000}${(seq++).toString().padStart(3, '0')}`.slice(0, 11);

  beforeEach(async () => {
    s = await seedTenant(app);
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S1', name: '销售部' } });
    const mk = async (empNo: string, name: string, uid: number) => Number((await prisma.employee.create({ data: { tenantId: s.tenantId, empNo, name, mobile: mob('135'), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: uid } })).id);
    EMP = await mk('E1', '李四', s.empUserId);
    MGR = await mk('M1', '王经理', s.mgrUserId);
    empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
    mgrToken = `Bearer ${signAccess({ uid: s.mgrUserId, tid: s.tenantId, roles: ['manager'], empId: MGR })}`;
  });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('FR-M12-003 三段式提交（勾选任务带入）+ 重复提交被拒 + 经理看团队报告与未交名单', async () => {
    const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '客户拜访', assigneeEmpId: EMP }).expect(201);
    const r = await request(app.getHttpServer()).post('/api/v1/reports').set('Authorization', empToken).send({
      reportType: 'daily', periodStart: '2026-10-06', periodEnd: '2026-10-06',
      donePart: '拜访 3 家客户', planPart: '明日完成方案报价', problemPart: '客户预算未定', relatedTaskIds: [t.body.id],
    }).expect(201);
    expect(r.body.status).toBe('submitted');
    // 重复提交
    await request(app.getHttpServer()).post('/api/v1/reports').set('Authorization', empToken).send({
      reportType: 'daily', periodStart: '2026-10-06', periodEnd: '2026-10-06', donePart: '再来一次', planPart: '计划',
    }).expect(409);
    // 团队视图
    const team = await request(app.getHttpServer()).get('/api/v1/reports/team?from=2026-10-01&to=2026-10-31&type=daily').set('Authorization', mgrToken).expect(200);
    expect(team.body.reports.length).toBe(1);
    expect(team.body.reports[0].relatedTaskIds).toEqual([t.body.id]);
    // 点评
    const cmt = await request(app.getHttpServer()).post(`/api/v1/reports/${r.body.id}/comment`).set('Authorization', mgrToken).send({ text: '继续保持' }).expect(201);
    expect(cmt.body.status).toBe('commented');
  });

  it('FR-M12-005 参考模式：评价表单过程数据卡片自动聚合', async () => {
    // 造数据：2 任务验收 + 1 日报
    for (const title of ['任务A', '任务B']) {
      const t = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title, assigneeEmpId: EMP }).expect(201);
      await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'in_progress' }).expect(201);
      await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', empToken).send({ to: 'submitted' }).expect(201);
      await request(app.getHttpServer()).post(`/api/v1/work-tasks/${t.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'accepted' }).expect(201);
    }
    await request(app.getHttpServer()).post('/api/v1/reports').set('Authorization', empToken).send({
      reportType: 'weekly', periodStart: '2026-10-05', periodEnd: '2026-10-11', donePart: '完成两项任务', planPart: '下周继续',
    }).expect(201);
    // 考核单
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: 'S', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q4', period: '2026Q4', startDate: new Date('2026-10-01'), endDate: new Date('2026-12-31'), status: 'RUNNING' } });
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: EMP, status: 'manager_review', finalScore: 80 } });
    const card = await request(app.getHttpServer()).get(`/api/v1/records/${rec.id}/task-stat`).set('Authorization', mgrToken).expect(200);
    expect(card.body.stat.taskTotal).toBe(2);
    expect(card.body.stat.taskAccepted).toBe(2);
    expect(card.body.reportCount).toBe(1);
    expect(card.body.recentReports[0].donePart).toContain('完成两项任务');
  });

  it('UAT 11-④ 加分模式：积分×系数计入总分并封顶（100 积分×0.1=10 → 封顶 +5）', async () => {
    // 悬赏 100 积分入账
    const wt = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '悬赏100', rewardPoints: 100 }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${wt.body.id}/claim`).set('Authorization', empToken).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${wt.body.id}/transition`).set('Authorization', empToken).send({ to: 'submitted' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${wt.body.id}/transition`).set('Authorization', mgrToken).send({ to: 'accepted' }).expect(201);
    // 方案开加分模式：rate 0.1 cap 5
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: 'S2', mode: 'kpi', periodType: 'quarter', status: 'LOCKED', taskCreditConfig: { enabled: true, mode: 'credit', rate: 0.1, cap: 5 } } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q4', period: '2026Q4', startDate: new Date('2026-10-01'), endDate: new Date('2026-12-31'), status: 'RUNNING' } });
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: EMP, status: 'manager_review', finalScore: 80 } });
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${rec.id}/task-credit`).set('Authorization', mgrToken).expect(201);
    expect(r.body.rawCredit).toBe(10);   // 100×0.1
    expect(r.body.creditApplied).toBe(5); // 封顶 5
    expect(r.body.finalScore).toBe(85);   // 80+5
  });
});
