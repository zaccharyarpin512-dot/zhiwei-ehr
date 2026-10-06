// WP-4 验收：部门树/409 删除拦截/员工成环拒绝/Excel 批量导入（FR-M01-001/002）
import { INestApplication } from '@nestjs/common';
import request from "supertest";
import * as ExcelJS from 'exceljs';
import { buildApp, seedTenant, cleanTenant } from './helpers';
import { PrismaService } from '../src/prisma.service';

describe('组织与人员（FR-M01-001/002）', () => {
  let app: INestApplication;
  let s: any;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { s = await seedTenant(app); });
  afterEach(async () => { await cleanTenant(app, s.tenantId); });

  const api = () => request(app.getHttpServer());

  it('创建 3 层部门树并按 sortNo 排序返回', async () => {
    const rootRes = await api().post("/api/v1/departments").set("Authorization", s.hrToken).send({ code: "ROOT", name: "智未科技", sortNo: 1 });
    expect(rootRes.status).toBe(201);
    const p = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'D1', name: '销售中心', parentId: rootRes.body.id, sortNo: 1 });
    const c1 = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'D1-1', name: '销售二部', parentId: p.body.id, sortNo: 2 });
    await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'D1-2', name: '销售一部', parentId: p.body.id, sortNo: 1 });
    const tree = await api().get('/api/v1/departments').set('Authorization', s.hrToken);
    expect(tree.status).toBe(200);
    const root = tree.body.find((d: any) => d.code === 'ROOT');
    const sales = root.children.find((d: any) => d.code === 'D1');
    expect(sales.children.map((d: any) => d.code)).toEqual(['D1-2', 'D1-1']); // sortNo 升序
  });

  it('删除有子部门的部门 → 409（AC1）', async () => {
    const p = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'P', name: '父部门' });
    await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'C', name: '子部门', parentId: p.body.id });
    const r = await api().delete(`/api/v1/departments/${p.body.id}`).set('Authorization', s.hrToken);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('请先处理');
  });

  it('删除有在职员工的部门 → 409 并提示人数', async () => {
    const d = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'D', name: '部门' });
    await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({
      empNo: 'ZW1', name: '张三', mobile: '13800001111', hireDate: '2024-01-01', departmentId: d.body.id, position: '专员',
    });
    const r = await api().delete(`/api/v1/departments/${d.body.id}`).set('Authorization', s.hrToken);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('1 名在职员工');
  });

  it('汇报上级成环 A→B→A → 保存被拒（AC2）', async () => {
    const d = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'D', name: '部门' });
    const a = await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({ empNo: 'A1', name: '甲', mobile: '13800002222', hireDate: '2024-01-01', departmentId: d.body.id, position: '经理' });
    const b = await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({ empNo: 'B1', name: '乙', mobile: '13800003333', hireDate: '2024-01-01', departmentId: d.body.id, position: '专员', managerEmpId: a.body.id });
    expect(b.status).toBe(201);
    // 让 A 的上级变成 B → 成环，必须被拒
    const r = await api().put(`/api/v1/employees/${a.body.id}`).set('Authorization', s.hrToken).send({ managerEmpId: b.body.id });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('形成环');
  });

  it('Excel 批量导入：2 条成功 + 2 条错误报告（AC1）', async () => {
    const d = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'IMP', name: '导入部' });
    const dept = await app.get(PrismaService).department.findFirst({ where: { code: 'IMP' } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['工号', '姓名', '手机号', '邮箱', '入职日期', '部门编号', '岗位', '职级', '汇报上级工号']);
    ws.addRow(['ZW9001', '钱七', '13811110001', '', '2024-05-01', 'IMP', '专员', 'P3', '']);           // OK
    ws.addRow(['ZW9002', '孙八', '13811110002', '', '2024-05-02', 'IMP', '专员', 'P3', 'ZW9001']);      // OK（有上级）
    ws.addRow(['ZW9003', '坏手机号', '123', '', '2024-05-03', 'IMP', '专员', 'P3', '']);                 // 错：手机号
    ws.addRow(['ZW9001', '重复工号', '13811110004', '', '2024-05-04', 'IMP', '专员', 'P3', '']);         // 错：P2002
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const r = await api().post('/api/v1/employees/import').set('Authorization', s.hrToken).attach('file', buf, 'emp.xlsx');
    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(2);
    expect(r.body.failed).toBe(2);
    expect(r.body.errors).toHaveLength(2);
    expect(r.body.errors.map((e: any) => e.row).sort()).toEqual([4, 5]);
    expect(r.body.errors.every((e: any) => e.reason)).toBe(true);
  });

  it('员工列表支持关键字搜索与分页结构', async () => {
    const d = await api().post('/api/v1/departments').set('Authorization', s.hrToken).send({ code: 'L', name: '列表部' });
    await api().post('/api/v1/employees').set('Authorization', s.hrToken).send({ empNo: 'ZWL1', name: '周九', mobile: '13811110009', hireDate: '2024-01-01', departmentId: d.body.id, position: '专员' });
    const r = await api().get('/api/v1/employees?keyword=周九').set('Authorization', s.hrToken);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.list[0].empNo).toBe('ZWL1');
    expect(r.body.page_size).toBe(20);
  });
});
