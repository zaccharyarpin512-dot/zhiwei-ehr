// WP-34/35 验收：任务日历 / 皮肤偏好多端同步 / PIP
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-34/35 日历·皮肤·PIP', () => {
  let app: INestApplication; let s: any; let prisma: any;
  let EMP = 0; let MGR = 0; let empToken = ''; let mgrToken = '';
  beforeAll(async () => { app = await buildApp(); prisma = app.get(PrismaService); });
  afterAll(async () => { await app.close(); });
  let seq = 0;
  const mob = (p: string) => `${p}${Date.now() % 100000}${(seq++).toString().padStart(3, '0')}`.slice(0, 11);

  beforeEach(async () => {
    s = await seedTenant(app);
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S1', name: '销售部' } });
    const mk = async (empNo: string, name: string, uid: number) => Number((await prisma.employee.create({ data: { tenantId: s.tenantId, empNo, name, mobile: mob('135'), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: uid } })).id);
    EMP = await mk('E1', '李四', s.empUserId);
    MGR = await mk('M1', '王经理', s.mgrUserId);
    empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
    mgrToken = `Bearer ${signAccess({ uid: s.mgrUserId, tid: s.tenantId, roles: ['manager'], empId: MGR })}`;
  });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('WP-34 日历：按截止日分组 + 统计条（本周 N｜逾期 N｜悬赏 N）', async () => {
    await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '周三任务', assigneeEmpId: EMP, dueDate: '2026-10-08', priority: 'high' }).expect(201);
    const mt = await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '悬赏任务', dueDate: '2026-10-09', rewardPoints: 30 }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/work-tasks/${mt.body.id}/claim`).set('Authorization', empToken).expect(201);
    await request(app.getHttpServer()).post('/api/v1/work-tasks').set('Authorization', mgrToken).send({ title: '逾期任务', assigneeEmpId: EMP, dueDate: '2026-10-01' }).expect(201);
    const r = await request(app.getHttpServer()).get('/api/v1/work-tasks/calendar?from=2026-09-28&to=2026-10-11').set('Authorization', empToken).expect(200);
    expect(r.body.byDate['2026-10-08'][0].title).toBe('周三任务');
    expect(r.body.byDate['2026-10-08'][0].priority).toBe('high');
    expect(r.body.summary.total).toBe(3);
    expect(r.body.summary.overdue).toBe(1);
    expect(r.body.summary.reward).toBe(1);
  });

  it('WP-35a 皮肤偏好账号级读写：换 sky 后回读生效（多端同步数据源）', async () => {
    const d1 = await request(app.getHttpServer()).get('/api/v1/me/preference').set('Authorization', empToken).expect(200);
    expect(d1.body.theme).toBe('coral'); // 默认
    await request(app.getHttpServer()).post('/api/v1/me/preference').set('Authorization', empToken).send({ theme: 'sky' }).expect(201);
    const d2 = await request(app.getHttpServer()).get('/api/v1/me/preference').set('Authorization', empToken).expect(200);
    expect(d2.body.theme).toBe('sky');
    // 非法主题 400
    const bad = await request(app.getHttpServer()).post('/api/v1/me/preference').set('Authorization', empToken).send({ theme: 'dark' });
    expect(bad.status).toBe(400);
  });

  it('WP-35b PIP：C/D 级可发起（留痕+员工待办），B 级被拒', async () => {
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: 'S', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q3', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    const recC = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: EMP, status: 'archived', finalScore: 62, grade: 'C' } });
    const recB = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: MGR, status: 'archived', finalScore: 82, grade: 'B' } });
    // C 级发起成功
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recC.id}/pip`).set('Authorization', mgrToken).send({ goals: '提升回款达成率至 80%', deadline: '2026-12-31' }).expect(201);
    expect(r.body.pip.status).toBe('active');
    const logs = await prisma.recordStatusLog.findMany({ where: { recordId: recC.id } });
    expect(logs.some((l: any) => l.note?.includes('发起 PIP'))).toBe(true);
    const todos = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', empToken).expect(200);
    expect(todos.body.some((t: any) => t.bizType === 'pip')).toBe(true);
    // B 级被拒 + 目标过短被拒
    await request(app.getHttpServer()).post(`/api/v1/records/${recB.id}/pip`).set('Authorization', mgrToken).send({ goals: '提升回款达成率至 80%', deadline: '2026-12-31' }).expect(409);
    await request(app.getHttpServer()).post(`/api/v1/records/${recC.id}/pip`).set('Authorization', mgrToken).send({ goals: '太短', deadline: '2026-12-31' }).expect(400);
  });
});
