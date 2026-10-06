// M01 组织与人员服务（FR-M01-001/002）
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma.service';
import { Errors } from '../../common/errors';
import { mustCtx } from '../../tenant-context';

@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) {}

  // ---------- 部门 ----------
  async deptTree() {
    const all = await this.prisma.department.findMany({ orderBy: { sortNo: 'asc' }, where: { isDeleted: false } });
    const byParent = new Map<number | null, any[]>();
    all.forEach((d) => {
      const pid = d.parentId == null ? null : Number(d.parentId);
      const list = byParent.get(pid) || [];
      list.push({ ...d, id: Number(d.id), children: [] });
      byParent.set(pid, list);
    });
    const build = (pid: number | null): any[] =>
      (byParent.get(pid) || []).map((d) => ({ ...d, children: build(d.id) }));
    return build(null);
  }

  async createDept(dto: any) {
    const dup = await this.prisma.department.findFirst({ where: { code: dto.code, isDeleted: false } });
    if (dup) throw Errors.MOBILE_DUPLICATED(); // 部门编号重复按 409 处理（复用错误码语义）
    const dept = await this.prisma.department.create({
      data: { tenantId: mustCtx().tenantId, code: dto.code, name: dto.name, parentId: dto.parentId ?? null, managerUserId: dto.managerUserId ?? null, sortNo: dto.sortNo ?? 0 },
    });
    return { id: Number(dept.id) };
  }

  async updateDept(id: number, dto: any) {
    const dept = await this.prisma.department.update({ where: { id }, data: dto });
    if (!dept) throw Errors.NOT_FOUND();
    return { id: Number(dept.id) };
  }

  async removeDept(id: number) {
    const children = await this.prisma.department.count({ where: { parentId: id, isDeleted: false } });
    const emps = await this.prisma.employee.count({ where: { departmentId: id, status: { in: ['ACTIVE', 'PROBATION'] } } });
    if (children > 0 || emps > 0) throw Errors.DEPT_HAS_CHILDREN_OR_EMP(emps);
    await this.prisma.department.update({ where: { id }, data: { isDeleted: true } });
    return { ok: true };
  }

  // ---------- 员工 ----------
  async listEmp(q: { deptId?: number; keyword?: string; status?: string; page: number; pageSize: number }) {
    const where: any = { isDeleted: false };
    if (q.deptId) where.departmentId = q.deptId;
    if (q.keyword) where.OR = [{ name: { contains: q.keyword } }, { empNo: { contains: q.keyword } }, { mobile: { contains: q.keyword } }];
    if (q.status) where.status = q.status;
    const [list, total] = await Promise.all([
      this.prisma.employee.findMany({ where, orderBy: { empNo: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.employee.count({ where }),
    ]);
    return { list: list.map((e) => ({ ...e, id: Number(e.id) })), total, page: q.page, page_size: q.pageSize };
  }

  private async checkManagerCycle(id: number | undefined, managerEmpId: number | undefined) {
    if (!managerEmpId) return;
    if (id && managerEmpId === id) throw Errors.MANAGER_CYCLE();
    // 沿上级链向上走，若遇到自己则成环（A→B→A）
    let cur = managerEmpId;
    const guard = new Set<number>();
    while (cur) {
      if (id && cur === id) throw Errors.MANAGER_CYCLE();
      if (guard.has(cur)) break;
      guard.add(cur);
      const e = await this.prisma.employee.findFirst({ where: { id: cur }, select: { managerEmpId: true } });
      cur = e?.managerEmpId ? Number(e.managerEmpId) : 0;
    }
  }

  async createEmp(dto: any) {
    await this.checkManagerCycle(undefined, dto.managerEmpId ? Number(dto.managerEmpId) : undefined);
    try {
      const emp = await this.prisma.employee.create({
        data: {
          tenantId: mustCtx().tenantId,
          empNo: dto.empNo, name: dto.name, mobile: dto.mobile, email: dto.email,
          hireDate: new Date(dto.hireDate), departmentId: dto.departmentId ? Number(dto.departmentId) : 0,
          position: dto.position, jobLevel: dto.jobLevel, managerEmpId: dto.managerEmpId ? Number(dto.managerEmpId) : null,
        },
      });
      return { id: Number(emp.id) };
    } catch (e: any) {
      if (e?.code === 'P2002') throw Errors.MOBILE_DUPLICATED();
      throw e;
    }
  }

  async updateEmp(id: number, dto: any) {
    await this.checkManagerCycle(id, dto.managerEmpId ? Number(dto.managerEmpId) : undefined);
    const data: any = { ...dto };
    if (data.hireDate) data.hireDate = new Date(data.hireDate);
    if (data.departmentId) data.departmentId = Number(data.departmentId);
    if (data.managerEmpId) data.managerEmpId = Number(data.managerEmpId);
    const emp = await this.prisma.employee.update({ where: { id }, data });
    if (!emp) throw Errors.NOT_FOUND();
    return { id: Number(emp.id) };
  }

  // Excel 批量导入（FR-M01-002 AC1：导入错误行生成错误报告）
  async importEmp(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('EMPTY_FILE');
    const errors: any[] = [];
    let ok = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const v = (c: number) => (row.getCell(c).value ?? '').toString().trim();
      const rec = { empNo: v(1), name: v(2), mobile: v(3), email: v(4), hireDate: v(5), departmentId: v(6), position: v(7), jobLevel: v(8), managerEmpNo: v(9) };
      try {
        if (!rec.empNo || !rec.name || !/^1\d{10}$/.test(rec.mobile)) throw new Error('工号/姓名必填，手机号须为 11 位数字');
        if (!rec.hireDate || isNaN(Date.parse(rec.hireDate))) throw new Error('入职日期格式不正确（须 YYYY-MM-DD）');
        const dept = rec.departmentId ? await this.prisma.department.findFirst({ where: { code: rec.departmentId, isDeleted: false } }) : null;
        let managerEmpId: number | null = null;
        if (rec.managerEmpNo) {
          const m = await this.prisma.employee.findFirst({ where: { empNo: rec.managerEmpNo } });
          if (!m) throw new Error(`汇报上级工号 ${rec.managerEmpNo} 不存在`);
          managerEmpId = Number(m.id);
        }
        await this.prisma.employee.create({
          data: {
            tenantId: mustCtx().tenantId,
            empNo: rec.empNo, name: rec.name, mobile: rec.mobile, email: rec.email || null,
            hireDate: new Date(rec.hireDate), departmentId: dept ? Number(dept.id) : 0,
            position: rec.position, jobLevel: rec.jobLevel || null, managerEmpId,
          },
        });
        ok++;
      } catch (e: any) {
        errors.push({ row: r, ...rec, reason: e?.code === 'P2002' ? '工号或手机号已存在' : e.message });
      }
    }
    return { success: errors.length === 0, imported: ok, failed: errors.length, errors };
  }

  async importTemplate() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('员工导入');
    ws.addRow(['工号', '姓名', '手机号', '邮箱', '入职日期', '部门编号', '岗位', '职级', '汇报上级工号']);
    ws.addRow(['ZW1001', '李四', '13800000001', 'lisi@example.com', '2024-03-01', 'D001', '大客户经理', 'P4', '']);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }
}
