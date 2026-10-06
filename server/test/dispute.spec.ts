// WP-22 结果申诉与面谈闭环验收（FR-M05-006 / FR-M07-001）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('WP-22 结果申诉与面谈闭环（FR-M05-006 / FR-M07-001）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let taskId: number; let recId: number;
  let EMP = 0; let MGR = 0;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    s = await seedTenant(app);
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: '方案', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q3', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    taskId = Number(task.id);
    // 员工/经理的 emp 绑定（消息/待办路由用），EMP/MGR 取真实 emp.id
    const dDept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'DD', name: '默认部' } });
    const empRow = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'E1', departmentId: dDept.id, name: '李四', mobile: `138${Date.now()}${Math.floor(Math.random()*99)}`.slice(0,11), hireDate: new Date('2023-01-01'), position: '专员', userId: s.empUserId } });
    const mgrRow = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'M1', departmentId: dDept.id, name: '王经理', mobile: `137${Date.now()}${Math.floor(Math.random()*99)}`.slice(0,11), hireDate: new Date('2020-01-01'), position: '经理', userId: s.mgrUserId } });
    EMP = Number(empRow.id); MGR = Number(mgrRow.id);
    // 员工令牌携带真实 empId（本人操作判定依据）
    const { signAccess } = await import('../src/lib/jwt');
    s.empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: EMP, managerEmpId: MGR, status: 'result_confirm', finalScore: 72.8, grade: 'B', publishTime: new Date() } });
    recId = Number(rec.id);
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const emp = () => s.empToken;
  const hr = () => s.hrToken;

  it('FR-M05-006 申诉闭环：发起→HR处理（调整）→回到结果确认→通知员工', async () => {
    const a = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/appeal`).set('Authorization', emp()).send({ reason: '客观指标口径理解有误' }).expect(201);
    // 状态进入申诉中
    let rec = await prisma.assessmentRecord.findFirst({ where: { id: recId } });
    expect(rec.status).toBe('appealing');
    // HR 有待办
    const hrTodos = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', hr()).expect(200);
    expect(hrTodos.body.some((t: any) => t.bizType === 'appeal')).toBe(true);
    // 重复申诉被拒
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/appeal`).set('Authorization', emp()).send({ reason: '再来一次' }).expect(409);
    // HR 调整：72.8 → 85.5 / A
    const h = await request(app.getHttpServer()).put(`/api/v1/appeals/${a.body.id}/handle`).set('Authorization', hr()).send({ result: 'adjust', note: '复核后确认回款少计一笔', newScore: 85.5, newGrade: 'A' }).expect(200);
    expect(h.body.status).toBe('ADJUSTED');
    rec = await prisma.assessmentRecord.findFirst({ where: { id: recId } });
    expect(Number(rec.finalScore)).toBe(85.5);
    expect(rec.grade).toBe('A');
    expect(rec.status).toBe('result_confirm');
    // 员工收到通知
    const msgs = await request(app.getHttpServer()).get('/api/v1/messages').set('Authorization', emp()).expect(200);
    expect(msgs.body.some((m: any) => m.bizType === 'appeal_result')).toBe(true);
    // 重复处理被拒
    await request(app.getHttpServer()).put(`/api/v1/appeals/${a.body.id}/handle`).set('Authorization', hr()).send({ result: 'uphold', note: '再处理' }).expect(409);
  });

  it('非本人不能申诉；未发布不能申诉（状态硬约束）', async () => {
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/appeal`).set('Authorization', s.mgrToken).send({ reason: '替他申诉' }).expect(403);
    await prisma.assessmentRecord.update({ where: { id: recId }, data: { status: 'manager_review' } });
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/appeal`).set('Authorization', emp()).send({ reason: '太早了' }).expect(409);
  });

  it('FR-M07-001 面谈闭环：经理提交→员工确认→归档→任务自动 FINISHED', async () => {
    const iv = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/interview`).set('Authorization', s.mgrToken).send({ summary: '本期整体达标，回款指标波动需关注', improvementGoals: 'Q4 建立周度回款复盘机制' }).expect(201);
    let rec = await prisma.assessmentRecord.findFirst({ where: { id: recId } });
    expect(rec.status).toBe('interviewing');
    // 员工有待办确认
    const todos = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', emp()).expect(200);
    expect(todos.body.some((t: any) => t.bizType === 'interview')).toBe(true);
    // 员工确认 → 归档
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/interview/confirm`).set('Authorization', emp()).send({ comment: '认可面谈结论' }).expect(201);
    rec = await prisma.assessmentRecord.findFirst({ where: { id: recId } });
    expect(rec.status).toBe('archived');
    const ivRow = await prisma.interviewRecord.findFirst({ where: { id: iv.body.id } });
    expect(ivRow.employeeConfirmed).toBe(true);
    // 唯一一张考核单归档 → 任务自动 FINISHED
    const task = await prisma.assessmentTask.findFirst({ where: { id: taskId } });
    expect(task.status).toBe('FINISHED');
  });

  it('面谈处理说明/新分缺失被拒；employee 不能代为确认他人', async () => {
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/appeal`).set('Authorization', emp()).send({ reason: '测试' }).expect(201);
    const a = await prisma.appeal.findFirst({ where: { recordId: recId } });
    await request(app.getHttpServer()).put(`/api/v1/appeals/${a.id}/handle`).set('Authorization', hr()).send({ result: 'adjust', note: '', newScore: 80 }).expect(400);
    await request(app.getHttpServer()).put(`/api/v1/appeals/${a.id}/handle`).set('Authorization', hr()).send({ result: 'adjust', note: '缺新分' }).expect(400);
  });
});
