// WP-9 验收：指标库 CRUD + 口径校验 + 停用不出现在选择器 + 口径预览 + 填报人（FR-M02-001/002/004）
import { INestApplication } from '@nestjs/common';
import request from "supertest";
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('指标库（FR-M02-001/002/004）', () => {
  let app: INestApplication;
  let s: any;
  let deptId: number;
  let empId: number;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    s = await seedTenant(app);
    const api = () => request(app.getHttpServer());
    const d = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'FIN', name: '财务部' });
    deptId = d.body.id;
    const e = await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'F1', name: '张会计', mobile: '13822220001', hireDate: '2023-01-01', departmentId: deptId, position: '会计',
    });
    empId = e.body.id;
    await api().post('/api/v1/indicator-categories').set('Authorization', s.hrToken).send({ name: '业绩类' });
  });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());

  it('AC2：部门出数未选出数部门 → 40010 拦截；员工自报无需出数部门', async () => {
    const r1 = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '季度回款额', statScope: 'ytd', sourceType: 'dept_report' });
    expect(r1.status).toBe(400);
    expect(r1.body.code).toBe(40010);
    const r2 = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '团队协作自评', statScope: 'current', sourceType: 'self_report' });
    expect(r2.status).toBe(201);
    expect(r2.body.dataOwnerDeptId).toBeNull();
  });

  it('自定义累计未选累计起点 → 40011 拦截', async () => {
    const r = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '累计产值', statScope: 'cumulative', sourceType: 'self_report' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40011);
    const ok = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '累计产值', statScope: 'cumulative', cumulativeFrom: 'hire_date', sourceType: 'self_report' });
    expect(ok.status).toBe(201);
  });

  it('AC1：停用指标不出现在方案选择器（for_scheme=1），常规列表仍可见', async () => {
    const c = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '临时指标', statScope: 'current', sourceType: 'self_report' });
    await api().delete(`/api/v1/indicators/${c.body.id}`).set('Authorization', s.hrToken);
    const forScheme = await api().get('/api/v1/indicators?for_scheme=1').set('Authorization', s.hrToken);
    expect(forScheme.body.find((i: any) => i.name === '临时指标')).toBeUndefined();
    const all = await api().get('/api/v1/indicators').set('Authorization', s.hrToken);
    expect(all.body.find((i: any) => i.name === '临时指标').status).toBe('DISABLED');
  });

  it('AC3/AC4：部门出数指标带 🔒 客观标识并预览 Q3 统计窗口', async () => {
    const r = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '季度回款额', statScope: 'ytd', sourceType: 'dept_report', dataOwnerDeptId: deptId, scoreRule: { type: 'rate', base: 100, cap: 120, floor: 0 } });
    expect(r.status).toBe(201);
    expect(r.body.objectiveBadge).toBe('🔒 客观指标');
    expect(r.body.group).toBe('objective');
    expect(r.body.scopePreview).toContain('2026-01-01 ~ 2026-09-30');
  });

  it('FR-M02-004：填报人设置 1~2 人并可查询；超过 2 人拒绝', async () => {
    const e2 = await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'F2', name: '李出纳', mobile: '13822220002', hireDate: '2023-01-01', departmentId: deptId, position: '出纳',
    });
    const tooMany = await api().put(`/api/v1/departments/${deptId}/data-fillers`).set('Authorization', s.hrToken)
      .send({ fillerEmpIds: [empId, e2.body.id, empId] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toContain('最多设置 2 名');
    const ok = await api().put(`/api/v1/departments/${deptId}/data-fillers`).set('Authorization', s.hrToken)
      .send({ fillerEmpIds: [empId, e2.body.id] });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(2);
    expect(ok.body[0].isPrimary).toBe(true);
    const get = await api().get(`/api/v1/departments/${deptId}/data-fillers`).set('Authorization', s.hrToken);
    expect(get.body).toHaveLength(2);
  });
});
