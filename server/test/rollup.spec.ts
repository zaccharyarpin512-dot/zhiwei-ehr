// WP-23/24 周期关联验收（FR-M03-005 / FR-M05-009）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('WP-23/24 周期关联（FR-M03-005 / FR-M05-009）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let schemeId: number; let empId: number;
  let q1Task: number; let q2Task: number; let yearTask: number; let yearRec: number;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  async function mkTask(name: string, period: string, linkageConfig?: any, linkedTaskIds?: number[]) {
    const t = await prisma.assessmentTask.create({ data: {
      tenantId: s.tenantId, schemeId, schemeVersion: 1, name, period,
      startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
      status: 'RUNNING', ...(linkedTaskIds ? { linkedTaskIds } : {}),
    } });
    return Number(t.id);
  }
  async function mkRecord(taskId: number, score: number | null, grade?: string) {
    const r = await prisma.assessmentRecord.create({ data: {
      tenantId: s.tenantId, taskId, empId, status: 'archived',
      ...(score != null ? { finalScore: score } : {}), ...(grade ? { grade } : {}),
    } });
    return Number(r.id);
  }

  beforeEach(async () => {
    s = await seedTenant(app);
    const hrT = s.hrToken;
    const api = () => request(app.getHttpServer());
    const dept = await api().post('/api/v1/departments').set('Authorization', hrT).send({ code: 'D1', name: '销售部' });
    const emp = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'E1', name: '李四', mobile: `136${Date.now()}${Math.floor(Math.random()*99)}`.slice(0, 11), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.body.id, userId: s.empUserId } });
    empId = Number(emp.id);
    // 通过 API 建方案（拿 linkage_config 结构校验），weighted 模式
    const sc = await api().post('/api/v1/schemes').set('Authorization', hrT).send({
      name: '年度关联方案', mode: 'kpi', periodType: 'year',
      nodes: [{ nodeType: 'goal_setting', seq: 1 }, { nodeType: 'manager_review', seq: 2 }],
      indicators: [{ indicatorId: (await api().post('/api/v1/indicators').set('Authorization', hrT).send({ name: '回款', statScope: 'current', sourceType: 'manager_review' })).body.id, weight: 100 }],
    });
    schemeId = sc.body.id;
    // Q1/Q2 已归档任务（FINISHED + 员工得分）
    q1Task = await mkTask('Q1考核', '2026Q1');
    await mkRecord(q1Task, 80);
    q2Task = await mkTask('Q2考核', '2026Q2');
    await mkRecord(q2Task, 90);
    await prisma.assessmentTask.update({ where: { id: q1Task }, data: { status: 'FINISHED' } });
    await prisma.assessmentTask.update({ where: { id: q2Task }, data: { status: 'FINISHED' } });
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  async function makeYearTask(linkageConfig: any, linked: number[]) {
    yearTask = await mkTask('年度考核', '2026年度', undefined, linked);
    await prisma.scheme.update({ where: { id: schemeId }, data: { linkageConfig } });
    yearRec = await mkRecord(yearTask, 85); // 本期自评汇总分 85
    return yearRec;
  }

  it('FR-M05-009 关联未归档任务 → 40003', async () => {
    const running = await mkTask('Q3考核', '2026Q3'); // RUNNING，未归档
    const r = await request(app.getHttpServer()).post('/api/v1/tasks').set('Authorization', s.hrToken).send({
      schemeId, name: '年度', period: '2026年度', startDate: '2026-10-01', endDate: '2026-12-31', linkedTaskIds: [q1Task, running],
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(40003);
  });

  it('AC1 linkable 推荐：只返回已 FINISHED 的任务', async () => {
    await mkTask('Q3考核', '2026Q3');
    const r = await request(app.getHttpServer()).get(`/api/v1/schemes/${schemeId}/linkable-tasks`).set('Authorization', s.hrToken).expect(200);
    const ids = r.body.map((t: any) => t.id);
    expect(ids).toContain(q1Task);
    expect(ids).toContain(q2Task);
    expect(ids.length).toBe(2);
  });

  it('weighted 加权汇入：年度=80×30%+90×30%+85×40%=85，明细可见折算', async () => {
    const recId = await makeYearTask({ enabled: true, mode: 'weighted', selfRatio: 40, periodWeights: [{ taskId: q1Task, weight: 30 }, { taskId: q2Task, weight: 30 }], missingPolicy: 'renormalize' }, [q1Task, q2Task]);
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/rollup/compute`).set('Authorization', s.hrToken).expect(201);
    expect(r.body.finalScore).toBe(85);
    expect(r.body.mode).toBe('weighted');
    const periods = r.body.rollupDetail.periods;
    expect(periods.find((p: any) => p.taskId === q1Task).score).toBe(80);
    expect(periods.find((p: any) => p.taskId === q2Task).effectiveWeight).toBe(30);
  });

  it('缺期折算：员工缺 Q2 → 权重归一（Q1 占 60% 联动权重）', async () => {
    const recId = await makeYearTask({ enabled: true, mode: 'weighted', selfRatio: 40, periodWeights: [{ taskId: q1Task, weight: 30 }, { taskId: q2Task, weight: 30 }], missingPolicy: 'renormalize' }, [q1Task, q2Task]);
    // 删掉该员工 Q2 的考核单 → 缺期
    await prisma.assessmentRecord.deleteMany({ where: { taskId: q2Task, empId } });
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/rollup/compute`).set('Authorization', s.hrToken).expect(201);
    // 80×60% + 85×40% = 48+34 = 82
    expect(r.body.finalScore).toBe(82);
    const q1p = r.body.rollupDetail.periods.find((p: any) => p.taskId === q1Task);
    const q2p = r.body.rollupDetail.periods.find((p: any) => p.taskId === q2Task);
    expect(q1p.effectiveWeight).toBe(60);
    expect(q2p.missing).toBe(true);
  });

  it('修订联动：Q1 得分修改后 recalc 自动重算总分并通知 HR', async () => {
    const recId = await makeYearTask({ enabled: true, mode: 'weighted', selfRatio: 40, periodWeights: [{ taskId: q1Task, weight: 30 }, { taskId: q2Task, weight: 30 }], missingPolicy: 'renormalize' }, [q1Task, q2Task]);
    await request(app.getHttpServer()).post(`/api/v1/records/${recId}/rollup/compute`).set('Authorization', s.hrToken);
    // Q1 因申诉从 80 改为 100
    await prisma.assessmentRecord.updateMany({ where: { taskId: q1Task, empId }, data: { finalScore: 100 } });
    const r = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/rollup/recalc`).set('Authorization', s.hrToken).expect(201);
    // 100×30% + 90×30% + 85×40% = 30+27+34 = 91
    expect(r.body.finalScore).toBe(91);
    const hrMsgs = await request(app.getHttpServer()).get('/api/v1/messages').set('Authorization', s.hrToken).expect(200);
    expect(hrMsgs.body.some((m: any) => m.bizType === 'rollup_recalc')).toBe(true);
  });

  it('reference 参考展示：不改总分只落明细；point 积分映射按段定级', async () => {
    // reference
    const recId = await makeYearTask({ enabled: true, mode: 'reference' }, [q1Task, q2Task]);
    const rr = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/rollup/compute`).set('Authorization', s.hrToken).expect(201);
    expect(rr.body.finalScore).toBe(85); // 原分不动
    expect(rr.body.rollupDetail.mode).toBe('reference');
    // point
    await prisma.assessmentRecord.updateMany({ where: { taskId: q1Task, empId }, data: { grade: 'A' } });
    await prisma.assessmentRecord.updateMany({ where: { taskId: q2Task, empId }, data: { grade: 'S' } });
    await prisma.scheme.update({ where: { id: schemeId }, data: { linkageConfig: { enabled: true, mode: 'point', pointMap: [{ grade: 'S', point: 5 }, { grade: 'A', point: 4 }], gradeBands: [{ min: 9, max: 99, grade: 'S' }, { min: 0, max: 8.99, grade: 'A' }] } } });
    const rp = await request(app.getHttpServer()).post(`/api/v1/records/${recId}/rollup/compute`).set('Authorization', s.hrToken).expect(201);
    expect(rp.body.rollupDetail.totalPoints).toBe(9); // A=4 + S=5
    const fresh: any = await prisma.assessmentRecord.findFirst({ where: { id: recId } });
    expect(fresh.grade).toBe('S');
  });
});
