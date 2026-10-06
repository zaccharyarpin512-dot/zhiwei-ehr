// M02 指标库服务（FR-M02-001/002/004）
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { Errors } from '../../common/errors';
import { deriveStatWindow } from '../../lib/stat-window';
import { mustCtx } from '../../tenant-context';

@Injectable()
export class IndicatorService {
  constructor(private prisma: PrismaService) {}

  async categories() {
    const list = await this.prisma.indicatorCategory.findMany({ where: { isDeleted: false }, orderBy: { sortNo: 'asc' } });
    return list.map((c) => ({ ...c, id: Number(c.id) }));
  }

  async createCategory(dto: { name: string; sortNo?: number }) {
    const c = await this.prisma.indicatorCategory.create({ data: { tenantId: mustCtx().tenantId, name: dto.name, sortNo: dto.sortNo ?? 0 } });
    return { id: Number(c.id) };
  }

  private validate(dto: any) {
    // AC2：部门出数必须选出数部门；自定义累计必须选累计起点
    if (dto.sourceType === 'dept_report' && !dto.dataOwnerDeptId) throw Errors.OWNER_DEPT_REQUIRED();
    if (dto.sourceType !== 'dept_report' && 'dataOwnerDeptId' in dto && dto.sourceType) dto.dataOwnerDeptId = null;
    if (dto.statScope === 'cumulative' && !dto.cumulativeFrom) throw Errors.CUMULATIVE_FROM_REQUIRED();
  }

  async list(q: { categoryId?: number; keyword?: string; forScheme?: boolean }) {
    const where: any = { isDeleted: false };
    if (q.forScheme) where.status = 'ENABLED'; // AC1：停用指标不出现在方案选择器
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.keyword) where.name = { contains: q.keyword };
    const list = await this.prisma.indicator.findMany({ where, orderBy: { id: 'desc' } });
    return list.map((i) => this.decorate(i));
  }

  private decorate(i: any) {
    return {
      ...i, id: Number(i.id), categoryId: i.categoryId ? Number(i.categoryId) : null,
      dataOwnerDeptId: i.dataOwnerDeptId ? Number(i.dataOwnerDeptId) : null,
      // AC3：客观指标自动标识
      objectiveBadge: i.sourceType === 'dept_report' || i.sourceType === 'auto_system' ? '🔒 客观指标' : null,
      group: i.sourceType === 'dept_report' || i.sourceType === 'auto_system' ? 'objective' : 'subjective',
      scopePreview: (() => {
        try {
          return deriveStatWindow({
            statScope: i.statScope as any,
            cumulativeFrom: i.cumulativeFrom as any,
            periodStart: new Date(2026, 6, 1), periodEnd: new Date(2026, 8, 30), // 预览示例：Q3
            customDate: new Date(2026, 0, 1),
            hireDate: new Date(2026, 0, 1),
            taskStart: new Date(2026, 0, 1),
          }).label; // AC4：口径即时预览
        } catch { return '口径预览不可用'; }
      })(),
    };
  }

  async create(dto: any) {
    this.validate(dto);
    const ind = await this.prisma.indicator.create({
      data: {
        tenantId: mustCtx().tenantId,
        name: dto.name, categoryId: dto.categoryId ?? null, definition: dto.definition, calcDesc: dto.calcDesc,
        scoreRule: dto.scoreRule ?? undefined, statScope: dto.statScope, cumulativeFrom: dto.cumulativeFrom ?? null,
        sourceType: dto.sourceType, dataOwnerDeptId: dto.dataOwnerDeptId ?? null,
        unit: dto.unit, positionTags: dto.positionTags ?? undefined,
        status: dto.status ?? 'ENABLED',
      },
    });
    return this.decorate(ind);
  }

  async update(id: number, dto: any) {
    const merged = { ...(await this.mustGet(id)), ...dto };
    this.validate(merged);
    const ind = await this.prisma.indicator.update({
      where: { id },
      data: {
        name: merged.name, categoryId: merged.categoryId ?? null, definition: merged.definition, calcDesc: merged.calcDesc,
        scoreRule: merged.scoreRule ?? undefined, statScope: merged.statScope, cumulativeFrom: merged.cumulativeFrom ?? null,
        sourceType: merged.sourceType, dataOwnerDeptId: merged.dataOwnerDeptId ?? null,
        unit: merged.unit, positionTags: merged.positionTags ?? undefined,
        status: merged.status,
      },
    });
    if (!ind) throw Errors.NOT_FOUND();
    return this.decorate(ind);
  }

  async disable(id: number) {
    const ind = await this.prisma.indicator.update({ where: { id }, data: { status: 'DISABLED' } });
    if (!ind) throw Errors.NOT_FOUND();
    return { ok: true };
  }

  private async mustGet(id: number) {
    const ind = await this.prisma.indicator.findFirst({ where: { id } });
    if (!ind) throw Errors.NOT_FOUND();
    return ind;
  }

  // ---------- 填报人（FR-M02-004：1~2 人，未设默认部门负责人）----------
  async getFillers(deptId: number) {
    const list = await this.prisma.deptDataFiller.findMany({ where: { deptId } });
    return list.map((f) => ({ ...f, id: Number(f.id), deptId: Number(f.deptId), fillerEmpId: Number(f.fillerEmpId) }));
  }

  async setFillers(deptId: number, fillerEmpIds: number[]) {
    if (fillerEmpIds.length > 2) throw Errors.TOO_MANY_FILLERS();
    const dept = await this.prisma.department.findFirst({ where: { id: deptId, isDeleted: false } });
    if (!dept) throw Errors.NOT_FOUND('部门不存在');
    for (const empId of fillerEmpIds) {
      const emp = await this.prisma.employee.findFirst({ where: { id: empId } });
      if (!emp) throw Errors.NOT_FOUND(`员工 ${empId} 不存在`);
    }
    await this.prisma.deptDataFiller.deleteMany({ where: { deptId } });
    for (const [i, empId] of fillerEmpIds.entries()) {
      await this.prisma.deptDataFiller.create({ data: { tenantId: mustCtx().tenantId, deptId, fillerEmpId: empId, isPrimary: i === 0 } });
    }
    return this.getFillers(deptId);
  }
}
