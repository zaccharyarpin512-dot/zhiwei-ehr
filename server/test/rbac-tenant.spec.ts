// WP-3/7/8 验收：RBAC 越权 403 + 租户隔离（FR-M11-002/004）+ 审计 before/after（FR-M11-003）
import { INestApplication } from '@nestjs/common';
import request from "supertest";
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('RBAC 与租户隔离（FR-M11-002/004）', () => {
  let app: INestApplication;
  let s: any;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { s = await seedTenant(app); });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());

  it('employee 创建指标 → 403（权限矩阵：指标库维护仅 hr_admin）', async () => {
    const r = await api().post('/api/v1/indicators').set('Authorization', s.empToken)
      .send({ name: 'x', statScope: 'current', sourceType: 'self_report' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe(40300);
  });

  it('manager 创建指标 → 403；hr_admin 创建部门 → 201', async () => {
    const r1 = await api().post('/api/v1/indicators').set('Authorization', s.mgrToken)
      .send({ name: 'x', statScope: 'current', sourceType: 'self_report' });
    expect(r1.status).toBe(403);
    const r2 = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'D9', name: '部门' });
    expect(r2.status).toBe(201);
  });

  it('跨租户隔离：B 租户看不到 A 租户的部门与员工（404/空列表）', async () => {
    const a = s;
    // A 租户建部门+员工
    await api().post('/api/v1/departments').set('Authorization', a.hrToken).send({ code: 'A-DEPT', name: 'A部门' });
    await api().post('/api/v1/employees').set('Authorization', a.hrToken).send({
      empNo: 'A-E', name: '甲', mobile: '13833330001', hireDate: '2024-01-01', position: '专员',
    });
    // B 租户（新种子）
    const b = await seedTenant(app);
    const list = await api().get('/api/v1/departments').set('Authorization', b.hrToken);
    expect(list.body.find((d: any) => d.code === 'A-DEPT')).toBeUndefined();
    const emps = await api().get('/api/v1/employees').set('Authorization', b.hrToken);
    expect(emps.body.total).toBe(0);
    // B 尝试更新 A 的部门 → 404
    const aDept = await app.get(PrismaService).department.findFirst({ where: { code: 'A-DEPT' } });
    const r = await api().put(`/api/v1/departments/${aDept.id}`).set('Authorization', b.hrToken).send({ name: '篡改' });
    expect(r.status).toBe(404);
    await cleanTenant(app, b.tenantId);
  });

  it('审计日志：更新指标记录 before/after；查询接口仅 hr_admin 可用', async () => {
    const c = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '旧名', statScope: 'current', sourceType: 'self_report' });
    await api().put(`/api/v1/indicators/${c.body.id}`).set('Authorization', s.hrToken).send({ name: '新名' });
    const prisma = app.get(PrismaService) as any;
    const logs = await prisma.auditLog.findMany({ where: { resourceType: 'Indicator' }, orderBy: { id: 'desc' } });
    const upd = logs.find((l: any) => l.action === 'update');
    expect(upd).toBeTruthy();
    expect(upd.before.name).toBe('旧名');
    expect(upd.after.name).toBe('新名');
    expect(Number(upd.userId)).toBe(s.hrUserId);
    // 查询权限
    const denied = await api().get('/api/v1/audit-logs').set('Authorization', s.empToken);
    expect(denied.status).toBe(403);
    const allowed = await api().get('/api/v1/audit-logs?resource_type=Indicator').set('Authorization', s.hrToken);
    expect(allowed.status).toBe(200);
    expect(allowed.body.total).toBeGreaterThanOrEqual(2);
  });
});
