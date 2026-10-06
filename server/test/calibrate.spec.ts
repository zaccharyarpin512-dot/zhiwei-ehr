// WP-21 校准与强制分布验收（FR-M06-002/003）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-21 校准与强制分布（FR-M06-002/003）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let taskId: number;
  let recIds: number[] = [];
  let otherMgrToken: string;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    s = await seedTenant(app);
    const hrT = s.hrToken;
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: '方案', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    // S ≤10%、A ≤30%，区间覆盖 0-100
    for (const [grade, min, max, ratio, sortNo] of [
      ['S', 90, 100, 10, 1], ['A', 80, 89.99, 30, 2], ['B', 70, 79.99, null, 3], ['C', 0, 69.99, null, 4],
    ] as any) {
      await prisma.schemeGradeRule.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, grade, minScore: min, maxScore: max, ratioLimit: ratio, sortNo } });
    }
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q3', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    taskId = Number(task.id);
    recIds = [];
    // 10 张 calibrating 考核单，前 3 张归「王经理」管（mgrUserId 对应 empId=1001），其余归别人
    for (let i = 0; i < 10; i++) {
      const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: 500 + i, status: 'calibrating', finalScore: 75 } });
      recIds.push(Number(rec.id));
    }
    await prisma.assessmentRecord.update({ where: { id: recIds[0] }, data: { managerEmpId: 1001, finalScore: 92 } });
    await prisma.assessmentRecord.update({ where: { id: recIds[1] }, data: { managerEmpId: 1001, finalScore: 85 } });
    // 另一个经理身份令牌（empId=2002，非这些单子的管理者 → 跨团队）
    const otherUser = await prisma.user.create({ data: { tenantId: s.tenantId, mobile: `139${Math.floor(Math.random()*9e7+1e7)}`, passwordHash: 'x', name: '赵经理', roles: ['manager'] } });
    otherMgrToken = `Bearer ${signAccess({ uid: Number(otherUser.id), tid: s.tenantId, roles: ['manager'], empId: 2002 })}`;
    void hrT;
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('正常定级写回 grade + 分布快照', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recIds[0]}/grade`).set('Authorization', s.hrToken).send({ grade: 'S' }).expect(201);
    expect(r.body.grade).toBe('S');
    const dist = await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/distribution`).set('Authorization', s.hrToken).expect(200);
    expect(dist.body.distribution.S).toBe(1);
  });

  it('FR-M06-002 强制分布：S 上限 10%，第 2 个 S 被拒 40002', async () => {
    await request(app.getHttpServer()).post(`/api/v1/records/${recIds[0]}/grade`).set('Authorization', s.hrToken).send({ grade: 'S' }).expect(201);
    await prisma.assessmentRecord.update({ where: { id: recIds[1] }, data: { finalScore: 95 } });
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recIds[1]}/grade`).set('Authorization', s.hrToken).send({ grade: 'S' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40002);
  });

  it('得分越档定级被拒（92 分不能定 B）', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recIds[0]}/grade`).set('Authorization', s.hrToken).send({ grade: 'B' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40008);
  });

  it('FR-M06-003 跨团队调整：无理由 40009；有理由成功且留痕', async () => {
    const noReason = await request(app.getHttpServer()).post(`/api/v1/records/${recIds[0]}/grade`).set('Authorization', otherMgrToken).send({ grade: 'A' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe(40009);
    // 改回区间内的分数再调
    await prisma.assessmentRecord.update({ where: { id: recIds[0] }, data: { finalScore: 85 } });
    const ok = await request(app.getHttpServer()).post(`/api/v1/records/${recIds[0]}/grade`).set('Authorization', otherMgrToken).send({ grade: 'A', reason: '跨部门项目贡献突出' }).expect(201);
    expect(ok.body.grade).toBe('A');
    const logs = await prisma.recordStatusLog.findMany({ where: { recordId: recIds[0] } });
    expect(logs.some((l: any) => l.note?.includes('跨部门项目贡献突出'))).toBe(true);
  });

  it('非校准状态不能定级（40907）；employee 无权定级（403）', async () => {
    await prisma.assessmentRecord.update({ where: { id: recIds[2] }, data: { status: 'self_review' } });
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recIds[2]}/grade`).set('Authorization', s.hrToken).send({ grade: 'B' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe(40907);
    await request(app.getHttpServer()).post(`/api/v1/records/${recIds[3]}/grade`).set('Authorization', s.empToken).send({ grade: 'B' }).expect(403);
  });
});
