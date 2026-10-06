// WP-25 报表与个人绩效报告（FR-M09-001/002/003）
import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx } from '../../tenant-context';

@Injectable()
export class ReportService {
  constructor(private prisma: PrismaService) {}

  // FR-M09-003 个人绩效报告：总分/等级/指标明细（含口径）/评语/关联时间轴
  // 权限：本人 或 manager/hr（UAT 3：他人不能水平越权）
  async personalReport(recordId: number) {
    const c = ctx();
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const isSelf = c?.empId != null && Number(rec.empId) === c.empId;
    const privileged = c?.roles?.includes('hr_admin') || c?.roles?.includes('hr') ||
      (c?.roles?.includes('manager') && c?.empId != null && Number(rec.managerEmpId) === c.empId);
    if (!isSelf && !privileged) throw Errors.FORBIDDEN();

    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const emp: any = await this.prisma.employee.findFirst({ where: { id: rec.empId } });
    const [ris, reviewers, logs] = await Promise.all([
      this.prisma.recordIndicator.findMany({ where: { recordId } }),
      this.prisma.recordReviewer.findMany({ where: { recordId } }),
      this.prisma.recordStatusLog.findMany({ where: { recordId }, orderBy: { id: 'asc' } }),
    ]);
    const indicators = await Promise.all(ris.map(async (ri: any) => {
      const ind: any = await this.prisma.indicator.findFirst({ where: { id: ri.indicatorId } });
      return {
        indicatorId: Number(ri.indicatorId), indicatorName: ind?.name ?? `#${ri.indicatorId}`,
        statScope: ind?.statScope ?? null, sourceType: ind?.sourceType ?? null,
        targetValue: ri.targetValue != null ? Number(ri.targetValue) : null,
        selfScore: ri.selfScore != null ? Number(ri.selfScore) : null,
        managerScore: ri.managerScore != null ? Number(ri.managerScore) : null,
        weightedScore: ri.weightedScore != null ? Number(ri.weightedScore) : null,
        scoreSource: ri.scoreSource,
      };
    }));
    // 关联时间轴（周期关联方案）：各期得分卡片 + 加权过程
    const timeline = (rec.rollupDetail as any)?.periods
      ? { mode: (rec.rollupDetail as any).mode, periods: (rec.rollupDetail as any).periods, selfRatio: (rec.rollupDetail as any).selfRatio }
      : null;
    return {
      recordId: Number(rec.id), taskName: task?.name, period: task?.period,
      employee: emp ? { name: emp.name, empNo: emp.empNo } : null,
      finalScore: rec.finalScore != null ? Number(rec.finalScore) : null,
      grade: rec.grade, isProvisional: rec.isProvisional, status: rec.status,
      indicators,
      // 匿名规则：被评人视角互评人显示为 同事N（FR-M05-005 / UAT 2）
      reviewers: reviewers.map((r: any, i: number) => ({
        reviewerType: r.reviewerType, status: r.status,
        relationScore: r.relationScore != null ? Number(r.relationScore) : null,
        relationComment: r.relationComment,
        reviewer: (r.reviewerType === 'peer' && isSelf) ? `同事${i + 1}` : `#${r.reviewerEmpId}`,
      })),
      timeline,
      statusLogs: logs.map((l: any) => ({ from: l.fromStatus, to: l.toStatus, note: l.note, at: l.createdAt })),
    };
  }

  // FR-M09-001 进度看板：各节点人数 + 未完成名单（一键催办数据源）
  async progressBoard(taskId: number) {
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId } });
    const byStatus: Record<string, number> = {};
    const unfinished: any[] = [];
    for (const r of records) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.status !== 'archived') {
        const emp: any = await this.prisma.employee.findFirst({ where: { id: r.empId } });
        unfinished.push({ recordId: Number(r.id), employeeName: emp?.name ?? `#${r.empId}`, status: r.status });
      }
    }
    return { total: records.length, byStatus, unfinished };
  }

  // FR-M09-002 分布报表：等级 × 部门（或职级）交叉
  async distribution(taskId: number, by: 'dept' | 'grade' = 'dept') {
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId } });
    const rows: any[] = [];
    for (const r of records) {
      const emp: any = await this.prisma.employee.findFirst({ where: { id: r.empId } });
      const dept = emp?.departmentId != null
        ? await this.prisma.department.findFirst({ where: { id: emp.departmentId } })
        : null;
      rows.push({ grade: r.grade ?? '未定级', dept: dept?.name ?? '未分配', jobLevel: emp?.jobLevel ?? null, finalScore: r.finalScore != null ? Number(r.finalScore) : null });
    }
    if (by === 'grade') {
      const m: Record<string, number> = {};
      for (const r of rows) m[r.grade] = (m[r.grade] || 0) + 1;
      return { by, total: rows.length, distribution: m };
    }
    // dept × grade 交叉
    const cross: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      cross[r.dept] = cross[r.dept] || {};
      cross[r.dept][r.grade] = (cross[r.dept][r.grade] || 0) + 1;
    }
    return { by, total: rows.length, cross };
  }
}
