// WP-20 汇总引擎验收（FR-M06-001）：公式正确性 + 明细透明 + 待定标记 + 排名门槛
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('WP-20 成绩汇总引擎（FR-M06-001）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let taskId: number; let r1: number; let r2: number; let indObj: number; let indSub: number;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    s = await seedTenant(app);
    const hrT = s.hrToken;
    const api = () => request(app.getHttpServer());
    // 客观指标（权重 60）+ 主观指标（权重 40）
    const fin = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'FIN', name: '财务部' });
    indObj = (await api().post('/api/v1/indicators').set('Authorization', hrT).send({
      name: '季度回款额', statScope: 'current', sourceType: 'dept_report', dataOwnerDeptId: fin.body.id,
      scoreRule: { type: 'rate', base: 100, cap: 120, floor: 0 },
    })).body.id;
    indSub = (await api().post('/api/v1/indicators').set('Authorization', hrT).send({
      name: '团队协作', statScope: 'current', sourceType: 'manager_review',
    })).body.id;
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: '方案', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    await prisma.schemeIndicator.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, indicatorId: indObj, weight: 60 } });
    await prisma.schemeIndicator.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, indicatorId: indSub, weight: 40 } });
    await prisma.schemeReviewer.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, reviewerType: 'self', weight: 20 } });
    await prisma.schemeReviewer.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, reviewerType: 'manager', weight: 80 } });
    await prisma.schemeNode.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, nodeType: 'manager_review', seq: 1 } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q3', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    taskId = Number(task.id);
    for (const key of ['r1', 'r2']) {
      const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: s.empUserId + (key === 'r1' ? 11 : 22), status: 'calibrating' } });
      if (key === 'r1') r1 = Number(rec.id); else r2 = Number(rec.id);
      // 客观分：张三 90 加权 54；李四 80 加权 48
      const objScore = key === 'r1' ? 90 : 80;
      await prisma.recordIndicator.create({ data: { tenantId: s.tenantId, recordId: rec.id, indicatorId: indObj, scoreSource: 'data_fill', weightedScore: (objScore * 60) / 100 } });
      // 主观分：自评+上级评
      const self = key === 'r1' ? 80 : 70, mgr = key === 'r1' ? 90 : 60;
      await prisma.recordIndicator.create({ data: { tenantId: s.tenantId, recordId: rec.id, indicatorId: indSub, selfScore: self, managerScore: mgr } });
    }
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('总分=Σ客观加权+Σ主观×评价人权重，明细逐项透明', async () => {
    // 张三主观 = 80×0.2 + 90×0.8 = 88 → 加权 35.2；客观 54 → 总分 89.2
    const res = await request(app.getHttpServer()).post(`/api/v1/records/${r1}/aggregate`).set('Authorization', s.hrToken).expect(201);
    expect(res.body.finalScore).toBe(89.2);
    expect(res.body.isProvisional).toBe(false);
    const obj = res.body.lines.find((l: any) => l.indicatorId === indObj);
    const sub = res.body.lines.find((l: any) => l.indicatorId === indSub);
    expect(obj.detail).toContain('90 × 权重 60%');
    expect(sub.detail).toContain('自评 80×20%');
    expect(sub.detail).toContain('上级评 90×80%');
    expect(sub.weightedScore).toBe(35.2);
  });

  it('李四总分=48 + (70×0.2+60×0.8=62)×0.4 = 48+24.8=72.8', async () => {
    const res = await request(app.getHttpServer()).post(`/api/v1/records/${r2}/aggregate`).set('Authorization', s.hrToken).expect(201);
    expect(res.body.finalScore).toBe(72.8);
  });

  it('客观未填报 → 该项待定，总分 provisional', async () => {
    await prisma.recordIndicator.updateMany({ where: { recordId: r2, indicatorId: indObj }, data: { weightedScore: null } });
    const res = await request(app.getHttpServer()).post(`/api/v1/records/${r2}/aggregate`).set('Authorization', s.hrToken).expect(201);
    expect(res.body.isProvisional).toBe(true);
  });

  it('排名：按总分降序；评价未完成时拒绝排名（40906）', async () => {
    await request(app.getHttpServer()).post(`/api/v1/records/${r1}/aggregate`).set('Authorization', s.hrToken);
    await request(app.getHttpServer()).post(`/api/v1/records/${r2}/aggregate`).set('Authorization', s.hrToken);
    const rank = await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/rank`).set('Authorization', s.hrToken).expect(200);
    expect(rank.body[0].finalScore).toBe(89.2);
    expect(rank.body[1].finalScore).toBe(72.8);
    // 再加一张未完成的考核单 → 排名被拒
    await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId, empId: 999, status: 'self_review' } });
    await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/rank`).set('Authorization', s.hrToken).expect(409);
  });

  it('权限：employee 不能触发汇总与排名', async () => {
    await request(app.getHttpServer()).post(`/api/v1/records/${r1}/aggregate`).set('Authorization', s.empToken).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/rank`).set('Authorization', s.empToken).expect(403);
  });
});
