// WP-16 验收：目标提交/审批 + 自评 + 上级评价（FR-M05-002/003/004，UAT 8-②）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('目标/自评/上级评价（FR-M05-002/003/004）', () => {
  let app: INestApplication;
  let s: any;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  let indObj: number; let indSub: number;
  let e1EmpId: number; let e2EmpId: number; let mgrEmpId: number;
  let e1Rec: number; let e2Rec: number;
  let hrT: string; let e1T: string; let e2T: string; let mgrT: string;

  async function setup(withApproval = false) {
    s = await seedTenant(app);
    const api = () => request(app.getHttpServer());
    hrT = s.hrToken;
    const fin = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'FIN', name: '财务部' });
    const mgt = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'MGT', name: '管理层' });
    const lead = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'LEAD', name: '领导层' });
    indObj = (await api().post('/api/v1/indicators').set('Authorization', hrT).send({
      name: '回款额', statScope: 'ytd', sourceType: 'dept_report', dataOwnerDeptId: fin.body.id,
      scoreRule: { type: 'rate', base: 100, cap: 120, floor: 0 },
    })).body.id;
    indSub = (await api().post('/api/v1/indicators').set('Authorization', hrT).send({
      name: '主动性', statScope: 'current', sourceType: 'manager_review',
    })).body.id;
    const mgr = await api().post('/api/v1/employees').set('Authorization', hrT).send({
      empNo: 'M1', name: '钱经理', mobile: '13888880001', hireDate: '2023-01-01', departmentId: lead.body.id, position: '经理',
    });
    mgrEmpId = mgr.body.id;
    const e1 = await api().post('/api/v1/employees').set('Authorization', hrT).send({
      empNo: 'E1', name: '李四', mobile: '13888880002', hireDate: '2024-01-01', departmentId: mgt.body.id, position: '专员', managerEmpId: mgrEmpId,
    });
    const e2 = await api().post('/api/v1/employees').set('Authorization', hrT).send({
      empNo: 'E2', name: '王五', mobile: '13888880003', hireDate: '2024-01-01', departmentId: mgt.body.id, position: '专员', managerEmpId: mgrEmpId,
    });
    e1EmpId = e1.body.id; e2EmpId = e2.body.id;
    const prisma = app.get(PrismaService);
    await prisma.employee.update({ where: { id: e1EmpId }, data: { userId: s.empUserId } });
    await prisma.employee.update({ where: { id: e2EmpId }, data: { userId: s.mgrUserId } });
    const nodes: any[] = [{ nodeType: 'goal_setting', seq: 1 }];
    if (withApproval) nodes.push({ nodeType: 'goal_approval', seq: 2 });
    nodes.push(
      { nodeType: 'data_fill', seq: withApproval ? 3 : 2 },
      { nodeType: 'self_review', seq: withApproval ? 4 : 3 },
      { nodeType: 'manager_review', seq: withApproval ? 5 : 4 },
      { nodeType: 'calibrating', seq: withApproval ? 6 : 5 },
      { nodeType: 'archived', seq: withApproval ? 7 : 6 },
    );
    const sc = await api().post('/api/v1/schemes').set('Authorization', hrT).send({
      name: '评价方案', mode: 'kpi', periodType: 'quarter', scopeFilter: { deptIds: [mgt.body.id] },
      indicators: [{ indicatorId: indObj, weight: 60, defaultTarget: 500 }, { indicatorId: indSub, weight: 40 }],
      nodes, reviewers: [{ reviewerType: 'self', weight: 30 }, { reviewerType: 'manager', weight: 70 }],
    });
    await api().post('/api/v1/tasks').set('Authorization', hrT).send({
      schemeId: sc.body.id, name: '评价演练', period: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30',
    });
    const r1 = await prisma.assessmentRecord.findFirst({ where: { empId: e1EmpId } });
    const r2 = await prisma.assessmentRecord.findFirst({ where: { empId: e2EmpId } });
    e1Rec = Number(r1.id); e2Rec = Number(r2.id);
    e1T = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: e1EmpId })}`;
    e2T = `Bearer ${signAccess({ uid: s.mgrUserId, tid: s.tenantId, roles: ['employee'], empId: e2EmpId })}`;
    mgrT = `Bearer ${signAccess({ uid: s.hrUserId, tid: s.tenantId, roles: ['manager'], empId: mgrEmpId })}`;
  }
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());
  const advance = (rec: number, to: string) => api().post(`/api/v1/records/${rec}/advance`).set('Authorization', hrT).send({ toStatus: to });

  it('无审批节点：员工提交目标 → 目标值写入并同步填报行 → 自动推进到数据填报', async () => {
    await setup(false);
    const r = await api().post(`/api/v1/records/${e1Rec}/goal`).set('Authorization', e1T).send({
      targets: [{ indicatorId: indObj, targetValue: 520 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('data_fill');
    const prisma = app.get(PrismaService);
    const ri = await prisma.recordIndicator.findFirst({ where: { recordId: e1Rec, indicatorId: indObj } });
    expect(Number(ri.targetValue)).toBe(520);
    const item = await prisma.dataFillItem.findFirst({ where: { recordId: e1Rec, indicatorId: indObj } });
    expect(Number(item.targetValue)).toBe(520); // 填报行同步
  });

  it('有审批节点：提交后停留并派经理待办；驳回须附意见且留痕；通过后推进', async () => {
    await setup(true);
    const sub = await api().post(`/api/v1/records/${e1Rec}/goal`).set('Authorization', e1T).send({
      targets: [{ indicatorId: indObj, targetValue: 520 }],
    });
    expect(sub.body.status).toBe('goal_setting');
    expect(sub.body.pending).toBe('approval');
    const noComment = await api().post(`/api/v1/records/${e1Rec}/goal/approve`).set('Authorization', mgrT).send({ pass: false });
    expect(noComment.status).toBe(400);
    const rej = await api().post(`/api/v1/records/${e1Rec}/goal/approve`).set('Authorization', mgrT).send({ pass: false, comment: '目标过高' });
    expect(rej.status).toBe(201);
    expect(rej.body.rejected).toBe(true);
    const prisma = app.get(PrismaService);
    const todo = await prisma.todo.findFirst({ where: { userId: s.empUserId, bizType: 'goal_rejected' } });
    expect(todo.title).toContain('目标过高');
    const log = await prisma.recordStatusLog.findFirst({ where: { recordId: e1Rec, note: { contains: '目标驳回' } } });
    expect(log).toBeTruthy();
    // 重新提交 → 经理通过 → 推进 data_fill
    await api().post(`/api/v1/records/${e1Rec}/goal`).set('Authorization', e1T).send({ targets: [{ indicatorId: indObj, targetValue: 480 }] });
    const ok = await api().post(`/api/v1/records/${e1Rec}/goal/approve`).set('Authorization', mgrT).send({ pass: true });
    expect(ok.body.status).toBe('data_fill');
  });

  it('自评：仅主观指标可打分，提交即锁定（409），推进到上级评价', async () => {
    await setup(false);
    await api().post(`/api/v1/records/${e1Rec}/goal`).set('Authorization', e1T).send({ targets: [{ indicatorId: indObj, targetValue: 500 }] });
    await advance(e1Rec, 'self_review');
    // 含客观指标 → 403
    const withObj = await api().post(`/api/v1/records/${e1Rec}/self-review`).set('Authorization', e1T).send({
      scores: [{ indicatorId: indObj, score: 99 }], summary: 'x',
    });
    expect(withObj.status).toBe(403);
    // 正常自评
    const ok = await api().post(`/api/v1/records/${e1Rec}/self-review`).set('Authorization', e1T).send({
      scores: [{ indicatorId: indSub, score: 88, comment: '积极主动' }], summary: '本季度达成情况良好',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('manager_review');
    const prisma = app.get(PrismaService);
    const rec = await prisma.assessmentRecord.findFirst({ where: { id: e1Rec } });
    expect(rec.selfSubmittedAt).toBeTruthy();
    expect(rec.selfSummary).toContain('达成');
    // 再次提交 → 锁定
    const again = await api().post(`/api/v1/records/${e1Rec}/self-review`).set('Authorization', e1T).send({ scores: [{ indicatorId: indSub, score: 90 }] });
    expect(again.status).toBe(409);
  });

  it('上级评价：客观指标打分一律 403（UAT 8-②）；正常评价推进到校准', async () => {
    await setup(false);
    for (const rec of [e1Rec, e2Rec]) {
      await api().post(`/api/v1/records/${rec}/goal`).set('Authorization', rec === e1Rec ? e1T : e2T).send({ targets: [{ indicatorId: indObj, targetValue: 500 }] });
      await advance(rec, 'self_review');
      await api().post(`/api/v1/records/${rec}/self-review`).set('Authorization', rec === e1Rec ? e1T : e2T).send({ scores: [{ indicatorId: indSub, score: 85 }] });
    }
    // E1：经理尝试改客观分 → 403
    const hack = await api().post(`/api/v1/records/${e1Rec}/manager-review`).set('Authorization', mgrT).send({
      scores: [{ indicatorId: indObj, score: 100 }],
    });
    expect(hack.status).toBe(403);
    expect(hack.body.message).toContain('出数部门填报生成');
    // E2：正常评价 → calibrating
    const ok = await api().post(`/api/v1/records/${e2Rec}/manager-review`).set('Authorization', mgrT).send({
      scores: [{ indicatorId: indSub, score: 92, comment: '表现优秀' }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('calibrating');
    const prisma = app.get(PrismaService);
    const ri = await prisma.recordIndicator.findFirst({ where: { recordId: e2Rec, indicatorId: indSub } });
    expect(Number(ri.managerScore)).toBe(92);
    const rr = await prisma.recordReviewer.findFirst({ where: { recordId: e2Rec, reviewerType: 'manager' } });
    expect(rr.status).toBe('已评');
  });

  it('权限：非本人不能自评/交目标；非经理不能上级评；员工不能 HR 推进', async () => {
    await setup(false);
    const cross = await api().post(`/api/v1/records/${e1Rec}/goal`).set('Authorization', e2T).send({ targets: [{ indicatorId: indObj, targetValue: 1 }] });
    expect(cross.status).toBe(403);
    const selfAdvance = await api().post(`/api/v1/records/${e1Rec}/advance`).set('Authorization', e1T).send({ toStatus: 'data_fill' });
    expect(selfAdvance.status).toBe(403); // advance 已收紧为 HR
  });
});
