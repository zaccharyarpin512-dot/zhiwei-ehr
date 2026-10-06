// WP-25 报表与个人报告验收（FR-M09-001/002/003，含 UAT 3 水平越权）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

let mobSeq = 0;
const mob = (p: string) => `${p}${Date.now() % 100000}${(mobSeq++).toString().padStart(3, '0')}`.slice(0, 11);

describe('WP-25 报表与个人绩效报告（FR-M09-001/002/003）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let taskId: number; let recId: number; let EMP = 0;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    s = await seedTenant(app);
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S1', name: '销售一部' } });
    const dept2 = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S2', name: '销售二部' } });
    const emp = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'E1', name: '李四', mobile: mob('135').slice(0, 11), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: s.empUserId } });
    EMP = Number(emp.id);
    s.empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
    const scheme = await prisma.scheme.create({ data: { tenantId: s.tenantId, name: '方案', mode: 'kpi', periodType: 'quarter', status: 'LOCKED' } });
    const ind = await prisma.indicator.create({ data: { tenantId: s.tenantId, name: '季度回款额', statScope: 'current', sourceType: 'manager_review' } });
    const task = await prisma.assessmentTask.create({ data: { tenantId: s.tenantId, schemeId: scheme.id, schemeVersion: 1, name: 'Q3', period: '2026Q3', startDate: new Date('2026-07-01'), endDate: new Date('2026-09-30'), status: 'RUNNING' } });
    taskId = Number(task.id);
    const rec = await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: EMP, managerEmpId: 0, status: 'result_confirm', finalScore: 85.5, grade: 'A', isProvisional: false, publishTime: new Date(), rollupDetail: { mode: 'weighted', selfRatio: 40, periods: [{ taskId: 11, period: '2026Q1', score: 80, effectiveWeight: 30 }, { taskId: 12, period: '2026Q2', score: 90, effectiveWeight: 30 }] } } });
    recId = Number(rec.id);
    await prisma.recordIndicator.create({ data: { tenantId: s.tenantId, recordId: rec.id, indicatorId: ind.id, selfScore: 85, managerScore: 86, weightedScore: 85.5, scoreSource: 'review', targetValue: 100 } });
    // 其他同学：分布报表用
    for (const [nm, d, g] of [['王五', dept2.id, 'B'], ['赵六', dept.id, 'A'], ['孙七', dept2.id, 'B']] as any) {
      const e2 = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: nm, name: nm, mobile: mob('134').slice(0, 11), hireDate: new Date('2023-01-01'), position: '专员', departmentId: d } });
      await prisma.assessmentRecord.create({ data: { tenantId: s.tenantId, taskId: task.id, empId: e2.id, status: 'result_confirm', finalScore: 75, grade: g } });
    }
    await prisma.assessmentRecord.updateMany({ where: { taskId }, data: {} }); // no-op
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  it('FR-M09-003 个人报告：总分/等级/指标明细（含口径）/关联时间轴；本人可看', async () => {
    const r = await request(app.getHttpServer()).get(`/api/v1/records/${recId}/report`).set('Authorization', s.empToken).expect(200);
    expect(r.body.finalScore).toBe(85.5);
    expect(r.body.grade).toBe('A');
    expect(r.body.employee.name).toBe('李四');
    expect(r.body.indicators[0].indicatorName).toBe('季度回款额');
    expect(r.body.indicators[0].statScope).toBe('current');
    expect(r.body.indicators[0].managerScore).toBe(86);
    // 关联时间轴（周期关联方案）
    expect(r.body.timeline.mode).toBe('weighted');
    expect(r.body.timeline.periods.length).toBe(2);
    expect(r.body.timeline.periods[0].period).toBe('2026Q1');
  });

  it('UAT 3 水平越权：路人/其他员工猜 id 拿不到他人报告', async () => {
    const other = await prisma.user.create({ data: { tenantId: s.tenantId, mobile: mob('133').slice(0, 11), passwordHash: 'x', name: '路人', roles: ['employee'] } });
    const t = `Bearer ${signAccess({ uid: Number(other.id), tid: s.tenantId, roles: ['employee'], empId: 999999 })}`;
    await request(app.getHttpServer()).get(`/api/v1/records/${recId}/report`).set('Authorization', t).expect(403);
    // HR 可看
    await request(app.getHttpServer()).get(`/api/v1/records/${recId}/report`).set('Authorization', s.hrToken).expect(200);
  });

  it('FR-M09-001 进度看板：各节点人数 + 未完成名单', async () => {
    const r = await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/report/progress`).set('Authorization', s.hrToken).expect(200);
    expect(r.body.total).toBe(4);
    expect(r.body.byStatus.result_confirm).toBe(4);
    expect(r.body.unfinished.length).toBe(4);
    expect(r.body.unfinished[0].employeeName).toBeTruthy();
  });

  it('FR-M09-002 分布报表：等级分布 + 部门交叉', async () => {
    const byGrade = await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/report/distribution?by=grade`).set('Authorization', s.hrToken).expect(200);
    expect(byGrade.body.distribution.A).toBe(2);
    expect(byGrade.body.distribution.B).toBe(2);
    const byDept = await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/report/distribution?by=dept`).set('Authorization', s.hrToken).expect(200);
    expect(byDept.body.cross['销售一部'].A).toBe(2);
    expect(byDept.body.cross['销售二部'].B).toBe(2);
  });

  it('employee 无权看任务级报表（403）', async () => {
    await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/report/progress`).set('Authorization', s.empToken).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/tasks/${taskId}/report/distribution`).set('Authorization', s.empToken).expect(403);
  });
});
