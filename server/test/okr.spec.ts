// WP-30 OKR 验收（FR-M04-001/002/003/004）
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';
import { signAccess } from '../src/lib/jwt';

describe('WP-30 OKR 目标管理（FR-M04-001/002/003/004）', () => {
  let app: INestApplication;
  let s: any;
  let prisma: any;
  let empToken: string;
  let EMP = 0;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  let mobSeq = 0;
  const mob = (p: string) => `${p}${Date.now() % 100000}${(mobSeq++).toString().padStart(3, '0')}`.slice(0, 11);

  beforeEach(async () => {
    s = await seedTenant(app);
    const dept = await prisma.department.create({ data: { tenantId: s.tenantId, code: 'S1', name: '销售部' } });
    const emp = await prisma.employee.create({ data: { tenantId: s.tenantId, empNo: 'E1', name: '李四', mobile: mob('135'), hireDate: new Date('2023-01-01'), position: '专员', departmentId: dept.id, userId: s.empUserId } });
    EMP = Number(emp.id);
    empToken = `Bearer ${signAccess({ uid: s.empUserId, tid: s.tenantId, roles: ['employee'], empId: EMP })}`;
  });

  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const krs = [
    { title: '回款 500 万', measureType: 'currency', baseline: 0, target: 500, weight: 1 },
    { title: '新增客户 20 家', measureType: 'number', baseline: 0, target: 20, weight: 1 },
  ];

  it('FR-M04-001 创建 O+KR；KR 超 5 条被拒；我的目标列表', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/objectives').set('Authorization', empToken)
      .send({ period: '2026Q4', title: '成为区域销售冠军', keyResults: krs }).expect(201);
    expect(r.body.keyResults.length).toBe(2);
    expect(r.body.progress).toBe(0);
    const list = await request(app.getHttpServer()).get('/api/v1/objectives?period=2026Q4').set('Authorization', empToken).expect(200);
    expect(list.body.length).toBe(1);
    // 6 条 KR → 400
    const bad = await request(app.getHttpServer()).post('/api/v1/objectives').set('Authorization', empToken)
      .send({ period: '2026Q4', title: '太多KR', keyResults: Array(6).fill(krs[0]) });
    expect(bad.status).toBe(400);
  });

  it('FR-M04-003 KR 进展更新 → O 进度按权重自动重算（含基线）', async () => {
    const o = await request(app.getHttpServer()).post('/api/v1/objectives').set('Authorization', empToken)
      .send({ period: '2026Q4', title: '增长', keyResults: [
        { title: 'A', target: 100, baseline: 0, weight: 1 },
        { title: 'B', target: 200, baseline: 100, weight: 1 }, // 基线 100
      ] }).expect(201);
    const [krA, krB] = o.body.keyResults;
    // A 完成 50%（50/100），B 完成 50%（150-100/100）
    await request(app.getHttpServer()).put(`/api/v1/key-results/${krA.id}/progress`).set('Authorization', empToken).send({ current: 50, confidence: 'on_track' }).expect(200);
    let got = await request(app.getHttpServer()).get(`/api/v1/objectives/${o.body.id}`).set('Authorization', empToken).expect(200);
    expect(got.body.progress).toBe(25); // A 完成 50%、B 未开始：(0.5+0)/2
    await request(app.getHttpServer()).put(`/api/v1/key-results/${krB.id}/progress`).set('Authorization', empToken).send({ current: 150 }).expect(200);
    got = await request(app.getHttpServer()).get(`/api/v1/objectives/${o.body.id}`).set('Authorization', empToken).expect(200);
    expect(got.body.progress).toBe(50); // (0.5+0.5)/2
  });

  it('FR-M04-002 对齐树：O→上级 O 上链 + 下链', async () => {
    const parent = await request(app.getHttpServer()).post('/api/v1/objectives').set('Authorization', empToken)
      .send({ period: '2026Q4', title: '部门增长 30%', keyResults: [{ title: 'P', target: 100 }] }).expect(201);
    const child = await request(app.getHttpServer()).post('/api/v1/objectives').set('Authorization', empToken)
      .send({ period: '2026Q4', title: '个人贡献', alignToId: parent.body.id, keyResults: [{ title: 'C', target: 100 }] }).expect(201);
    const tree = await request(app.getHttpServer()).get(`/api/v1/objectives/${child.body.id}/align-tree`).set('Authorization', empToken).expect(200);
    expect(tree.body.upChain[0].title).toBe('部门增长 30%');
    const parentTree = await request(app.getHttpServer()).get(`/api/v1/objectives/${parent.body.id}/align-tree`).set('Authorization', empToken).expect(200);
    expect(parentTree.body.downChain[0].title).toBe('个人贡献');
  });

  it('FR-M04-004 KR 打分 → O 得分加权；越界分被拒', async () => {
    const o = await request(app.getHttpServer()).post('/api/v1/objectives').set('Authorization', empToken)
      .send({ period: '2026Q4', title: '加权打分', keyResults: [
        { title: 'KR1', target: 100, weight: 3 },
        { title: 'KR2', target: 100, weight: 1 },
      ] }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/key-results/${o.body.keyResults[0].id}/score`).set('Authorization', empToken).send({ score: 90 }).expect(201);
    const r = await request(app.getHttpServer()).post(`/api/v1/key-results/${o.body.keyResults[1].id}/score`).set('Authorization', empToken).send({ score: 70 }).expect(201);
    // (90×3 + 70×1)/4 = 85
    expect(r.body.score).toBe(85);
    const obj = await request(app.getHttpServer()).get(`/api/v1/objectives/${o.body.id}`).set('Authorization', empToken).expect(200);
    expect(obj.body.score).toBe(85);
    expect(obj.body.status).toBe('done');
    const bad = await request(app.getHttpServer()).post(`/api/v1/key-results/${o.body.keyResults[0].id}/score`).set('Authorization', empToken).send({ score: 120 });
    expect(bad.status).toBe(400);
  });
});
