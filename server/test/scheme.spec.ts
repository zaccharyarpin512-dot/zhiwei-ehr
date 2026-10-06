// WP-11 验收：方案 CRUD + 权重/节点硬校验 + 版本锁定 + 人群预览（FR-M03-001/002/003）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('绩效方案（FR-M03-001/002/003）', () => {
  let app: INestApplication;
  let s: any;
  let indObj: number;  // 客观指标
  let indSub: number;  // 主观指标
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    s = await seedTenant(app);
    const api = () => request(app.getHttpServer());
    const dept = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'S1', name: '销售部' });
    const o = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '季度回款额', statScope: 'ytd', sourceType: 'dept_report', dataOwnerDeptId: dept.body.id });
    const b = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '工作主动性', statScope: 'current', sourceType: 'manager_review' });
    indObj = o.body.id;
    indSub = b.body.id;
  });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());
  const baseScheme = () => ({
    name: '销售季度方案', mode: 'kpi', periodType: 'quarter',
    indicators: [{ indicatorId: indObj, weight: 60 }, { indicatorId: indSub, weight: 40 }],
    nodes: [
      { nodeType: 'goal_setting', seq: 1 },
      { nodeType: 'data_fill', seq: 2 },
      { nodeType: 'self_review', seq: 3 },
      { nodeType: 'manager_review', seq: 4 },
      { nodeType: 'calibrating', seq: 5 },
      { nodeType: 'result_confirm', seq: 6 },
      { nodeType: 'archived', seq: 7 },
    ],
    reviewers: [{ reviewerType: 'self', weight: 30 }, { reviewerType: 'manager', weight: 70 }],
    gradeRules: [
      { grade: 'S', minScore: 95, maxScore: 120, ratioLimit: 10, sortNo: 1 },
      { grade: 'A', minScore: 85, maxScore: 94.99, ratioLimit: 20, sortNo: 2 },
    ],
  });

  it('创建完整方案 → 201 且返回节点/指标/等级/评价关系（AC1）', async () => {
    const r = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send(baseScheme());
    expect(r.status).toBe(201);
    expect(r.body.nodes).toHaveLength(7);
    expect(r.body.indicators).toHaveLength(2);
    expect(r.body.gradeRules).toHaveLength(2);
    expect(r.body.reviewers).toHaveLength(2);
    expect(r.body.status).toBe('DRAFT');
  });

  it('AC2：KPI 权重合计 90% → 40001 拦截', async () => {
    const dto = baseScheme();
    dto.indicators = [{ indicatorId: indObj, weight: 50 }, { indicatorId: indSub, weight: 40 }];
    const r = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send(dto);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40001);
    expect(r.body.message).toContain('100');
  });

  it('数据填报节点仅当方案含客观指标时可用（40013）', async () => {
    const dto = baseScheme();
    dto.indicators = [{ indicatorId: indSub, weight: 100 }]; // 全是主观指标
    const r = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send(dto);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40013);
  });

  it('节点乱序/重复 → 40014 拦截', async () => {
    const dto = baseScheme();
    dto.nodes = [{ nodeType: 'self_review', seq: 1 }, { nodeType: 'goal_setting', seq: 2 }];
    const r = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send(dto);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40014);
  });

  it('FR-M03-002：被任务引用后方案锁定，修改被拒（409）', async () => {
    const sc = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send(baseScheme());
    // 造一名员工使任务可发起
    const dept = await app.get(PrismaService).department.findFirst({ where: { code: 'S1' } });
    await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'E1', name: '甲', mobile: '13855550001', hireDate: '2024-01-01', departmentId: dept.id, position: '专员',
    });
    const t = await api().post('/api/v1/tasks').set('Authorization', s.hrToken).send({
      schemeId: sc.body.id, name: 'Q3考核', period: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30',
    });
    expect(t.status).toBe(201);
    const after = await api().get(`/api/v1/schemes/${sc.body.id}`).set('Authorization', s.hrToken);
    expect(after.body.status).toBe('LOCKED');
    const upd = await api().put(`/api/v1/schemes/${sc.body.id}`).set('Authorization', s.hrToken).send({ name: '改名' });
    expect(upd.status).toBe(409);
  });

  it('方案复制 → 新草稿（AC3：修改副本不影响原方案）', async () => {
    const sc = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send(baseScheme());
    const cp = await api().post(`/api/v1/schemes/${sc.body.id}/copy`).set('Authorization', s.hrToken);
    expect(cp.status).toBe(201);
    expect(cp.body.id).not.toBe(sc.body.id);
    expect(cp.body.name).toContain('副本');
    expect(cp.body.status).toBe('DRAFT');
  });

  it('人群预览：按部门过滤返回命中名单与人数（FR-M03-003）', async () => {
    const prisma = app.get(PrismaService);
    const dept = await prisma.department.findFirst({ where: { code: 'S1' } });
    await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'P1', name: '预览甲', mobile: '13855550002', hireDate: '2024-01-01', departmentId: dept.id, position: '专员',
    });
    await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'P2', name: '预览乙', mobile: '13855550003', hireDate: '2024-01-01', position: '专员',
    });
    const r = await api().post('/api/v1/schemes/preview-audience').set('Authorization', s.hrToken)
      .send({ scopeFilter: { deptIds: [dept.id] } });
    expect(r.status).toBe(201);
    expect(r.body.count).toBe(1);
    expect(r.body.employees[0].name).toBe('预览甲');
  });
});
