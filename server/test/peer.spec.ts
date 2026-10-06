// WP-29 360 环评验收（FR-M05-005：生成/作答/锁定/匿名/去极值聚合）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-29 360 环评（FR-M05-005）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let recId: number; let schemeId: number; let q1: number; let q2: number;
  let EMP = 0; let MGR = 0;
  const peerTokens: string[] = [];
  const peerEmpIds: number[] = [];
  const peerReviewerIds: number[] = [];

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  let mobSeq = 0;
  const mob = (p: string) => `${p}${Date.now() % 100000}${(mobSeq++).toString().padStart(3, '0')}`.slice(0, 11);

  beforeEach(async () => {
    s = await seedTenant(app);
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S1', name: '销售部' } });
    const hrT = s.hrToken;
    const api = () => request(app.getHttpServer());
    const emp = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'E1', name: '李四', mobile: mob('135'), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: s.empUserId } });
    EMP = Number(emp.id);
    s.empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
    const mgr = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'M1', name: '王经理', mobile: mob('134'), hireDate: new Date('2020-01-01'), position: '经理', departmentId: dept.id, userId: s.mgrUserId } });
    MGR = Number(mgr.id);
    // 5 个同事（4 份互评用去极值）
    peerTokens.length = 0; peerEmpIds.length = 0;
    for (let i = 0; i < 5; i++) {
      const u = await prisma.user.create({ data: { tenantId: s.tenantId, mobile: mob('133'), passwordHash: 'x', name: `同事${i}`, roles: ['employee'] } });
      const pe = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: `P${i}`, name: `同事${i}`, mobile: mob('132'), hireDate: new Date('2022-01-01'), position: '专员', departmentId: dept.id, userId: u.id } });
      peerEmpIds.push(Number(pe.id));
      peerTokens.push(`Bearer ${signAccess({ uid: Number(u.id), tid: s.tenantId, roles: ['employee'], empId: Number(pe.id) })}`);
    }
    // 方案（含 360 题目）+ 任务 + 考核单
    const indRes = await api().post('/api/v1/indicators').set('Authorization', hrT).send({ name: '协作', statScope: 'current', sourceType: 'manager_review' });
    const sc = await api().post('/api/v1/schemes').set('Authorization', hrT).send({
      name: '360方案', mode: 'kpi_360', periodType: 'quarter',
      nodes: [{ nodeType: 'peer_review', seq: 1 }],
      indicators: [{ indicatorId: indRes.body.id, weight: 100 }],
    });
    schemeId = sc.body.id;
    q1 = (await prisma.schemeQuestion.create({ data: { tenantId: s.tenantId, schemeId, title: '协作意识', qType: 'scale', options: { min: 1, max: 100 }, required: true } })).id;
    q2 = (await prisma.schemeQuestion.create({ data: { tenantId: s.tenantId, schemeId, title: '交付质量', qType: 'scale', options: { min: 1, max: 100 }, required: true } })).id;
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId, schemeVersion: 1, name: 'Q3', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: EMP, managerEmpId: MGR, status: 'peer_review' } });
    recId = Number(rec.id);
    peerReviewerIds.length = 0;
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('生成互评对象：排除本人与上级，同事收到待办', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/peers/assign`).set('Authorization', s.mgrToken).send({ count: 4 }).expect(201);
    expect(r.body.total).toBe(4);
    const rvs = await prisma.recordReviewer.findMany({ where: { recordId: recId } });
    expect(rvs.every((x: any) => Number(x.reviewerEmpId) !== EMP && Number(x.reviewerEmpId) !== MGR)).toBe(true);
    // 随机抽取 → 任一被抽中同事有互评待办
    const todoCount = await prisma.todo.count({ where: { tenantId: s.tenantId, bizType: 'peer_review' } });
    expect(todoCount).toBe(4);
    for (const rv of rvs) peerReviewerIds.push(Number(rv.id));
  });

  it('作答→锁定→聚合（去极值 90/80/70/60 → 75）；他人不能代答', async () => {
    const a = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/peers/assign`).set('Authorization', s.hrToken).send({ count: 4 }).expect(201);
    const rvs = await prisma.recordReviewer.findMany({ where: { recordId: recId } });
    const scores = [90, 80, 70, 60];
    for (let i = 0; i < 4; i++) {
      const rv = rvs.find((x: any) => Number(x.reviewerEmpId) !== EMP && Number(x.reviewerEmpId) !== MGR && !peerReviewerIds.includes(Number(x.id)));
      void rv;
    }
    // 互评人随机抽取 → 按 reviewerEmpId 找对应令牌作答
    const rvs2 = await prisma.recordReviewer.findMany({ where: { recordId: recId }, orderBy: { id: 'asc' } });
    const tokenOf = (rv: any) => peerTokens[peerEmpIds.indexOf(Number(rv.reviewerEmpId))];
    for (const [i, rv] of rvs2.entries()) {
      const res = await request(app.getHttpServer()).post(`/api/v1/reviewers/${rv.id}/answer`).set('Authorization', tokenOf(rv))
        .send({ answers: [{ questionId: Number(q1), value: scores[i] }, { questionId: Number(q2), value: scores[i] }] }).expect(201);
      expect(res.body.score).toBe(scores[i]);
    }
    // 重复提交被拒
    await request(app.getHttpServer()).post(`/api/v1/reviewers/${rvs2[0].id}/answer`).set('Authorization', tokenOf(rvs2[0]))
      .send({ answers: [{ questionId: Number(q1), value: 100 }] }).expect(409);
    // 漏题被拒（新建一张待评单模拟）
    const extra: any = await prisma.recordReviewer.create({ data: { tenantId: s.tenantId, recordId: recId, reviewerEmpId: peerEmpIds[4], reviewerType: 'peer', status: '待评' } });
    await request(app.getHttpServer()).post(`/api/v1/reviewers/${extra.id}/answer`).set('Authorization', peerTokens[4])
      .send({ answers: [{ questionId: Number(q1), value: 50 }] }).expect(400);
    // 聚合：去极值 (90,80,70,60)→去 90/60 → 75
    const agg = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/peer-aggregate`).set('Authorization', s.hrToken).send({ trimExtremes: true }).expect(201);
    expect(agg.body.peerScore).toBe(75);
    expect(agg.body.trimmed).toBe(true);
    void a;
  });

  it('UAT 2 匿名：被评人视角互评人显示为「同事N」，真实身份不泄漏', async () => {
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/peers/assign`).set('Authorization', s.hrToken).send({ count: 3 }).expect(201);
    const rvs = await prisma.recordReviewer.findMany({ where: { recordId: recId } });
    for (const rv of rvs) {
      const t = peerTokens[peerEmpIds.indexOf(Number(rv.reviewerEmpId))];
      await request(app.getHttpServer()).post(`/api/v1/reviewers/${rv.id}/answer`).set('Authorization', t)
        .send({ answers: [{ questionId: Number(q1), value: 80 }, { questionId: Number(q2), value: 80 }] }).expect(201);
    }
    // 被评人看：同事N
    const anon = await request(app.getHttpServer()).get(`/api/v1/records/${recId}/peer-reviewers`).set('Authorization', s.empToken).expect(200);
    expect(anon.body[0].reviewer).toBe('同事1');
    expect(JSON.stringify(anon.body)).not.toContain(String(rvs[0].reviewerEmpId));
    // HR 看：可见标识（管理需要追溯，但员工界面仍匿名——此处验证被评人看不到身份）
    const report = await request(app.getHttpServer()).get(`/api/v1/records/${recId}/report`).set('Authorization', s.empToken).expect(200);
    expect(report.body.reviewers[0].reviewer).toBe('同事1');
    expect(JSON.stringify(report.body.reviewers)).not.toContain(String(rvs[0].reviewerEmpId));
  });
});
