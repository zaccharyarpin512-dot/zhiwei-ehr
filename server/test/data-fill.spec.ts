// WP-14 验收：FR-M05-008 全部 AC —— 出数拆单/口径固化/自动计分/防倒推/异议复核/退回重填/超期兜底/发布拦截
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('指标数据填报（FR-M05-008，数据真实性核心）', () => {
  let app: INestApplication;
  let s: any;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  let deptId: number; let mgrEmpId: number; let e1EmpId: number; let e2EmpId: number;
  let taskId: number; let orderId: number; let e1RecordId: number; let e1ItemId: number;
  let indObj: number;
  let hrT: string; let fillerT: string; let e1T: string; // hr / 填报人(经理) / 员工E1

  async function setup() {
    s = await seedTenant(app);
    const api = () => request(app.getHttpServer());
    hrT = s.hrToken;
    const dept = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'FIN', name: '财务出数部' });
    deptId = dept.body.id;
    indObj = (await api().post('/api/v1/indicators').set('Authorization', hrT).send({
      name: '季度回款额', statScope: 'ytd', sourceType: 'dept_report', dataOwnerDeptId: deptId,
      scoreRule: { type: 'rate', base: 100, cap: 120, floor: 0 }, unit: '万元',
    })).body.id;
    const indSub = (await api().post('/api/v1/indicators').set('Authorization', hrT).send({
      name: '主动性', statScope: 'current', sourceType: 'manager_review',
    })).body.id;
    const mgt = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'MGT', name: '管理层' });
    const lead = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'LEAD', name: '领导层' });
    const mgr = await api().post('/api/v1/employees').set('Authorization', hrT).send({
      empNo: 'M1', name: '钱经理', mobile: '13877770001', hireDate: '2023-01-01', departmentId: lead.body.id, position: '经理',
    });
    mgrEmpId = mgr.body.id;
    // E1 绑定 emp 用户、E2 绑定 mgr 用户（仅用于区分，不充当填报人）
    for (const [empNo, name, uid] of [['E1', '李四', s.empUserId], ['E2', '王五', s.mgrUserId]] as any) {
      const e = await api().post('/api/v1/employees').set('Authorization', hrT).send({
        empNo, name, mobile: `1387777${Math.floor(Math.random() * 9000 + 1000)}`, hireDate: '2024-01-01',
        departmentId: mgt.body.id, position: '专员', managerEmpId: mgrEmpId,
      });
      await app.get(PrismaService).employee.update({ where: { id: e.body.id }, data: { userId: uid } });
      if (empNo === 'E1') e1EmpId = e.body.id; else e2EmpId = e.body.id;
    }
    // 填报人 = 经理（显式设置，避免回落逻辑干扰）
    await api().put(`/api/v1/departments/${deptId}/data-fillers`).set('Authorization', hrT).send({ fillerEmpIds: [mgrEmpId] });
    const sc = await api().post('/api/v1/schemes').set('Authorization', hrT).send({
      name: '填报方案', mode: 'kpi', periodType: 'quarter', scopeFilter: { deptIds: [mgt.body.id] },
      indicators: [{ indicatorId: indObj, weight: 60, defaultTarget: 500 }, { indicatorId: indSub, weight: 40 }],
      nodes: [
        { nodeType: 'goal_setting', seq: 1 }, { nodeType: 'data_fill', seq: 2 }, { nodeType: 'self_review', seq: 3 },
        { nodeType: 'manager_review', seq: 4 }, { nodeType: 'calibrating', seq: 5 }, { nodeType: 'result_confirm', seq: 6 },
        { nodeType: 'archived', seq: 7 },
      ],
      reviewers: [{ reviewerType: 'self', weight: 30 }, { reviewerType: 'manager', weight: 70 }],
    });
    const t = await api().post('/api/v1/tasks').set('Authorization', hrT).send({
      schemeId: sc.body.id, name: '填报演练', period: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30',
    });
    taskId = t.body.id;
    // 带 empId 的令牌
    fillerT = `Bearer ${signAccess({ uid: s.hrUserId, tid: s.tenantId, roles: ['manager'], empId: mgrEmpId })}`;
    e1T = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: e1EmpId })}`;
    // 取工作单与行
    const prisma = app.get(PrismaService);
    const order = await prisma.dataFillOrder.findFirst({ where: { taskId } });
    orderId = Number(order.id);
    const rec = await prisma.assessmentRecord.findFirst({ where: { taskId, empId: e1EmpId } });
    e1RecordId = Number(rec.id);
    const item = await prisma.dataFillItem.findFirst({ where: { orderId, recordId: e1RecordId } });
    e1ItemId = Number(item.id);
  }
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());

  it('AC1：按出数部门拆单（2人×1客观指标=2行），主观指标不产生填报行', async () => {
    await setup();
    const orders = await api().get(`/api/v1/data-fill-orders?task_id=${taskId}`).set('Authorization', hrT);
    expect(orders.body).toHaveLength(1);
    expect(orders.body[0].totalRows).toBe(2);
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    expect(order.body.items).toHaveLength(2);
    // 每行带目标值（defaultTarget 500 固化）
    expect(Number(order.body.items[0].targetValue)).toBe(500);
  });

  it('AC6/AC7：YTD 口径行固化统计窗口 2026-01-01~2026-09-30', async () => {
    await setup();
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    const item = order.body.items.find((i: any) => Number(i.recordId) === e1RecordId);
    expect(item.statScope).toBe('ytd');
    expect(item.statWindowStart).toBe('2026-01-01');
    expect(item.statWindowEnd).toBe('2026-09-30');
  });

  it('AC5 防倒推：填报完成前员工本人拿不到客观分（HR/填报人可见）', async () => {
    await setup();
    const mine = await api().get(`/api/v1/records/${e1RecordId}`).set('Authorization', e1T);
    const maskedRow = mine.body.indicators.find((i: any) => Number(i.indicatorId) === indObj);
    expect(maskedRow.scoreMasked).toBe(true);
    expect(maskedRow.weightedScore).toBeNull();
    const hrView = await api().get(`/api/v1/records/${e1RecordId}`).set('Authorization', hrT);
    expect(hrView.body.indicators.find((i: any) => Number(i.indicatorId) === indObj).scoreMasked).toBeUndefined();
  });

  it('AC2：填报 480/500 → 自动计 96 分并按权重 60% 加权入考核单', async () => {
    await setup();
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    const items = order.body.items.map((i: any) => ({ recordId: i.recordId, indicatorId: i.indicatorId, actualValue: i.recordId === e1RecordId ? 480 : 430, evidenceNote: '回款明细见附表' }));
    const r = await api().post(`/api/v1/data-fill-orders/${orderId}/submit`).set('Authorization', fillerT).send({ items });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('SUBMITTED');
    const myItem = r.body.items.find((i: any) => Number(i.recordId) === e1RecordId);
    expect(Number(myItem.autoScore)).toBe(96);
    // 考核单加权分 = 96 × 60% = 57.6
    const rec = await api().get(`/api/v1/records/${e1RecordId}`).set('Authorization', hrT);
    const row = rec.body.indicators.find((i: any) => Number(i.indicatorId) === indObj);
    expect(row.scoreSource).toBe('data_fill');
    expect(Number(row.weightedScore)).toBeCloseTo(57.6, 1);
  });

  it('AC3：异议 → 复核修正 480→530 → 重算 106 分并全程留痕', async () => {
    await setup();
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    await api().post(`/api/v1/data-fill-orders/${orderId}/submit`).set('Authorization', fillerT).send({
      items: order.body.items.map((i: any) => ({ recordId: i.recordId, indicatorId: i.indicatorId, actualValue: 480 })),
    });
    // 员工本人提异议
    const obj = await api().post(`/api/v1/data-fill-items/${e1ItemId}/objection`).set('Authorization', e1T).send({ reason: '含 11 月未入账回款 50 万' });
    expect(obj.status).toBe(201);
    const prisma = app.get(PrismaService);
    const rec = await prisma.assessmentRecord.findFirst({ where: { id: e1RecordId } });
    expect(rec.isProvisional).toBe(true);
    // 填报人复核修正
    const fix = await api().put(`/api/v1/objections/${obj.body.id}`).set('Authorization', fillerT).send({ result: 'fix', newValue: 530, comment: '核实后修正' });
    expect(fix.status).toBe(200);
    const item = await prisma.dataFillItem.findFirst({ where: { id: e1ItemId } });
    expect(Number(item.actualValue)).toBe(530);
    expect(Number(item.autoScore)).toBe(106);
    const rec2 = await prisma.assessmentRecord.findFirst({ where: { id: e1RecordId } });
    expect(rec2.isProvisional).toBe(false); // 未结异议清零
    // 审计留痕：DataFillItem 的 update 记录了改前/改后
    const logs = await prisma.auditLog.findMany({ where: { resourceType: 'DataFillItem' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('退回重填：HR 退回（原因必填）→ 重新提交成功', async () => {
    await setup();
    const noReason = await api().post(`/api/v1/data-fill-orders/${orderId}/return`).set('Authorization', hrT).send({});
    expect(noReason.status).toBe(400);
    const back = await api().post(`/api/v1/data-fill-orders/${orderId}/return`).set('Authorization', hrT).send({ reason: '数据口径有误' });
    expect(back.status).toBe(201);
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    await api().post(`/api/v1/data-fill-orders/${orderId}/submit`).set('Authorization', fillerT).send({
      items: order.body.items.map((i: any) => ({ recordId: i.recordId, indicatorId: i.indicatorId, actualValue: 500 })),
    });
    const after = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    expect(after.body.status).toBe('SUBMITTED');
  });

  it('AC4 超期兜底：未填行 settle 按 0 分计并标记 defaultApplied', async () => {
    await setup();
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    // 只填 E1 一行
    await api().post(`/api/v1/data-fill-orders/${orderId}/submit`).set('Authorization', fillerT).send({
      items: [{ recordId: e1RecordId, indicatorId: indObj, actualValue: 480 }],
    });
    // 直接退回→再 settle？SUBMITTED 的 settle 处理剩余未填行
    const settled = await api().post(`/api/v1/data-fill-orders/${orderId}/settle`).set('Authorization', hrT);
    expect(settled.status).toBe(201);
    const e2Item = settled.body.items.find((i: any) => Number(i.recordId) !== e1RecordId);
    expect(Number(e2Item.autoScore)).toBe(0);
    expect(e2Item.defaultApplied).toBe(true);
    expect(settled.body.status).toBe('SETTLED');
  });

  it('发布拦截：存在未结异议时 publish 被 40018 拦截，处理后放行', async () => {
    await setup();
    const order = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', fillerT);
    await api().post(`/api/v1/data-fill-orders/${orderId}/submit`).set('Authorization', fillerT).send({
      items: order.body.items.map((i: any) => ({ recordId: i.recordId, indicatorId: i.indicatorId, actualValue: 480 })),
    });
    const obj = await api().post(`/api/v1/data-fill-items/${e1ItemId}/objection`).set('Authorization', e1T).send({ reason: '金额存疑' });
    // 推进到 calibrating
    const prisma = app.get(PrismaService);
    const recs = await prisma.assessmentRecord.findMany({ where: { taskId } });
    for (const r of recs) {
      for (const to of ['data_fill', 'self_review', 'manager_review', 'calibrating']) {
        await api().post(`/api/v1/records/${r.id}/advance`).set('Authorization', hrT).send({ toStatus: to });
      }
    }
    const blocked = await api().post(`/api/v1/tasks/${taskId}/publish`).set('Authorization', hrT);
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe(40018);
    // 复核维持 → 放行
    await api().put(`/api/v1/objections/${obj.body.id}`).set('Authorization', fillerT).send({ result: 'keep', comment: '核实无误' });
    const pub = await api().post(`/api/v1/tasks/${taskId}/publish`).set('Authorization', hrT);
    expect(pub.status).toBe(201);
    const after = await prisma.assessmentRecord.findMany({ where: { taskId } });
    expect(after.every((r) => r.status === 'result_confirm')).toBe(true);
    expect(after.every((r) => r.publishTime !== null)).toBe(true);
  });

  it('填报人权限：非填报人员工访问工作单 → 403', async () => {
    await setup();
    const denied = await api().get(`/api/v1/data-fill-orders/${orderId}`).set('Authorization', e1T);
    expect(denied.status).toBe(403);
  });
});
