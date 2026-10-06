// WP-17 待办/消息/催办测试（FR-M10-001/002/003）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { clearRemindLog } from '../src/modules/todo/todo.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-17 待办、消息与催办频控（FR-M10-001/002/003）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let taskId: number;
  let empRecordId: number;
  let empToken: string;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    s = await seedTenant(app);
    clearRemindLog();
    const api = () => request(app.getHttpServer());
    const hrT = s.hrToken;
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'SALES', name: '销售部' } });
    // 员工绑定 empToken 对应用户（登录员工视角）
    const emp = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'E1', name: '李四', mobile: `139${Math.floor(Math.random()*90000000+10000000)}`, hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: s.empUserId } });
    // 方案+任务（目标制定节点 → 员工有待办）
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: '方案', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    await prisma.schemeNode.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, nodeType: 'goal_setting', seq: 1 } });
    await prisma.schemeNode.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, nodeType: 'manager_review', seq: 2 } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q3考核', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    taskId = Number(task.id);
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: emp.id, status: 'goal_setting' } });
    empRecordId = Number(rec.id);
    await prisma.todo.create({ data: { tenantId: s.tenantId, userId: s.empUserId, bizType: 'assessment', bizId: String(rec.id), title: 'Q3考核：处理「目标制定」节点', actionUrl: `/records/${rec.id}` } });
    await prisma.message.create({ data: { tenantId: s.tenantId, userId: s.empUserId, title: '绩效结果已出', content: '您的 Q3 考核结果已发布' } });
    empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: Number(emp.id) })}`;
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('FR-M10-001 员工拉取自己的待办流，点击直达 action_url；完成待办', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', empToken).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toContain('目标制定');
    expect(res.body[0].actionUrl).toBe(`/records/${empRecordId}`);
    await request(app.getHttpServer()).post(`/api/v1/todos/${res.body[0].id}/done`).set('Authorization', empToken).expect(201);
    const after = await request(app.getHttpServer()).get('/api/v1/todos?status=待处理').set('Authorization', empToken).expect(200);
    expect(after.body.length).toBe(0);
  });

  it('FR-M10-002 消息中心：未读筛选 + 标记已读', async () => {
    const unread = await request(app.getHttpServer()).get('/api/v1/messages?unread=1').set('Authorization', empToken).expect(200);
    expect(unread.body.length).toBe(1);
    await request(app.getHttpServer()).put(`/api/v1/messages/${unread.body[0].id}/read`).set('Authorization', empToken).expect(200);
    const after = await request(app.getHttpServer()).get('/api/v1/messages?unread=1').set('Authorization', empToken).expect(200);
    expect(after.body.length).toBe(0);
  });

  it('FR-M10-003 催办 24h 内最多 3 次，第 4 次 blocked（UAT 7）', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await request(app.getHttpServer()).post(`/api/v1/tasks/${taskId}/remind`).set('Authorization', s.hrToken).send({ recordIds: [empRecordId] }).expect(201);
      expect(r.body.reminded).toBe(1);
    }
    const fourth = await request(app.getHttpServer()).post(`/api/v1/tasks/${taskId}/remind`).set('Authorization', s.hrToken).send({ recordIds: [empRecordId] }).expect(201);
    expect(fourth.body.reminded).toBe(0);
    expect(fourth.body.blocked).toBe(1);
    const msgs = await request(app.getHttpServer()).get('/api/v1/messages').set('Authorization', empToken).expect(200);
    expect(msgs.body.filter((m: any) => m.bizType === 'remind').length).toBe(3);
  });

  it('越权：他人不能替我完成待办（updateMany 按 userId 隔离）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', empToken).expect(200);
    const other = await prisma.user.create({ data: { tenantId: s.tenantId, mobile: `1399999${Math.floor(Math.random()*9000+1000)}`, passwordHash: 'x', name: '路人', roles: ['employee'] } });
    const otherToken = `Bearer ${signAccess({ uid: Number(other.id), tid: s.tenantId, roles: ['employee'] })}`;
    await request(app.getHttpServer()).post(`/api/v1/todos/${res.body[0].id}/done`).set('Authorization', otherToken).expect(201);
    const again = await request(app.getHttpServer()).get('/api/v1/todos').set('Authorization', empToken).expect(200);
    expect(again.body[0].status).toBe('待处理');
  });
});
