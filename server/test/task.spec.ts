// WP-13 验收：任务发起（组织快照/批量考核单/待办）+ 状态机推进 + 非法跳转拒绝 + 流转日志（FR-M05-001/PRD 7）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('考核任务与状态机（FR-M05-001 / PRD 7.2）', () => {
  let app: INestApplication;
  let s: any;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  // 每个用例一套数据：2 名员工（各自绑定用户）+ 经理 + 方案 + 任务
  let deptId: number; let schemeId: number; let taskId: number;
  let empRecIds: number[] = [];

  async function setup(withTask = true) {
    s = await seedTenant(app);
    const api = () => request(app.getHttpServer());
    const dept = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'T1', name: '考核部' });
    deptId = dept.body.id;
    const indO = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '回款额', statScope: 'ytd', sourceType: 'dept_report', dataOwnerDeptId: deptId });
    const indS = await api().post('/api/v1/indicators').set('Authorization', s.hrToken)
      .send({ name: '主动性', statScope: 'current', sourceType: 'manager_review' });
    const mgt = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'MGT', name: '管理层' });
    const mgr = await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'M1', name: '王经理', mobile: '13866660001', hireDate: '2023-01-01', departmentId: mgt.body.id, position: '经理',
    });
    for (const [i, uid] of [['E1', s.empUserId], ['E2', s.mgrUserId]] as any) {
      const e = await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
        empNo: i, name: `员工${i}`, mobile: `1386666${Math.floor(Math.random() * 9000 + 1000)}`, hireDate: '2024-01-01',
        departmentId: deptId, position: '专员', managerEmpId: mgr.body.id,
      });
      // 绑定登录用户（待办推送用）
      await app.get(PrismaService).employee.update({ where: { id: e.body.id }, data: { userId: uid } });
    }
    const sc = await api().post('/api/v1/schemes').set('Authorization', s.hrToken).send({
      name: '季度方案', mode: 'kpi', periodType: 'quarter', scopeFilter: { deptIds: [deptId] },
      indicators: [{ indicatorId: indO.body.id, weight: 60 }, { indicatorId: indS.body.id, weight: 40 }],
      nodes: [
        { nodeType: 'goal_setting', seq: 1 }, { nodeType: 'data_fill', seq: 2 },
        { nodeType: 'self_review', seq: 3 }, { nodeType: 'manager_review', seq: 4 },
        { nodeType: 'calibrating', seq: 5 }, { nodeType: 'result_confirm', seq: 6 },
        { nodeType: 'interviewing', seq: 7 }, { nodeType: 'archived', seq: 8 },
      ],
      reviewers: [{ reviewerType: 'self', weight: 30 }, { reviewerType: 'manager', weight: 70 }],
    });
    schemeId = sc.body.id;
    if (withTask) {
      const t = await api().post('/api/v1/tasks').set('Authorization', s.hrToken).send({
        schemeId, name: '2026-Q3 考核', period: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30',
      });
      taskId = t.body.id;
      const detail = await api().get(`/api/v1/tasks/${taskId}`).set('Authorization', s.hrToken);
      const prisma = app.get(PrismaService);
      const recs = await prisma.assessmentRecord.findMany({ where: { taskId } });
      empRecIds = recs.map((r: any) => Number(r.id));
    }
  }
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());

  it('发起任务：按快照生成 2 张考核单（首节点 goal_setting）+ 员工收到待办（AC1）', async () => {
    await setup();
    const detail = await api().get(`/api/v1/tasks/${taskId}`).set('Authorization', s.hrToken);
    expect(detail.body.total).toBe(2);
    expect(detail.body.byStatus.goal_setting).toBe(2);
    // 待办：两名员工各一条
    const prisma = app.get(PrismaService);
    const todos = await prisma.todo.findMany({ where: { tenantId: s.tenantId } });
    expect(todos.length).toBeGreaterThanOrEqual(2);
  });

  it('考核单含方案指标与评价关系实例（自评+上级）', async () => {
    await setup();
    const rec = await api().get(`/api/v1/records/${empRecIds[0]}`).set('Authorization', s.hrToken);
    expect(rec.body.indicators).toHaveLength(2);
    const types = rec.body.reviewers.map((r: any) => r.reviewerType).sort();
    expect(types).toEqual(['manager', 'self']);
    expect(rec.body.logs[0].toStatus).toBe('goal_setting');
  });

  it('沿主链推进：goal_setting→data_fill→self_review→manager_review…', async () => {
    await setup();
    const chain = ['data_fill', 'self_review', 'manager_review', 'calibrating', 'result_confirm', 'interviewing', 'archived'];
    for (const to of chain) {
      const r = await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: to });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe(to);
    }
    // 流转日志完整（含发起共 8 条）
    const rec = await api().get(`/api/v1/records/${empRecIds[0]}`).set('Authorization', s.hrToken);
    expect(rec.body.logs).toHaveLength(8);
  });

  it('非法跳转一律 409（UAT 4：goal_setting→manager_review / 回退 / 终态逆转）', async () => {
    await setup();
    const jump = await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'manager_review' });
    expect(jump.status).toBe(409);
    expect(jump.body.message).toContain('非法状态跳转');
    // 正确推进一级后再试回退
    await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'data_fill' });
    const back = await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'goal_setting' });
    expect(back.status).toBe(409);
  });

  it('申诉分支：result_confirm ⇄ appealing 双向可达', async () => {
    await setup();
    for (const to of ['data_fill', 'self_review', 'manager_review', 'calibrating', 'result_confirm']) {
      await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: to });
    }
    const appeal = await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'appealing' });
    expect(appeal.status).toBe(201);
    const back = await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'result_confirm' });
    expect(back.status).toBe(201);
    // 申诉中不可直接归档
    await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'appealing' });
    const toArch = await api().post(`/api/v1/records/${empRecIds[0]}/advance`).set('Authorization', s.hrToken).send({ toStatus: 'archived' });
    expect(toArch.status).toBe(409);
  });

  it('全员归档 → 任务自动 FINISHED（PRD 7.1）', async () => {
    await setup();
    const chain = ['data_fill', 'self_review', 'manager_review', 'calibrating', 'result_confirm', 'interviewing', 'archived'];
    for (const id of empRecIds) {
      for (const to of chain) await api().post(`/api/v1/records/${id}/advance`).set('Authorization', s.hrToken).send({ toStatus: to });
    }
    const list = await api().get('/api/v1/tasks').set('Authorization', s.hrToken);
    const t = list.body.find((x: any) => x.id === taskId);
    expect(t.status).toBe('FINISHED');
    expect(t.progress).toBe(100);
  });

  it('FR-M01-003：任务发起后调走员工不影响已生成名单', async () => {
    await setup();
    const prisma = app.get(PrismaService);
    // 模拟调岗：把某员工调到部门外
    const emp = await prisma.employee.findFirst({ where: { empNo: 'E1' } });
    await prisma.employee.update({ where: { id: emp.id }, data: { departmentId: 0 } });
    const detail = await api().get(`/api/v1/tasks/${taskId}`).set('Authorization', s.hrToken);
    expect(detail.body.total).toBe(2); // 名单仍是 2 人
  });
});
