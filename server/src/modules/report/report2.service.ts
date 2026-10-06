// WP-33 日报周报 + 考核对接（FR-M12-003/005）
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

@Injectable()
export class ReportService2 {
  constructor(private prisma: PrismaService) {}

  // 三段式提交（勾选任务自动带入=前端组合，后端校验任务归属）
  async submit(dto: { reportType: 'daily' | 'weekly'; periodStart: string; periodEnd: string; donePart: string; planPart: string; problemPart?: string; relatedTaskIds?: number[] }) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    if (dto.donePart.trim().length < 2) throw new BusinessError(40019, '「今日完成」必填', 400);
    if (dto.planPart.trim().length < 2) throw new BusinessError(40019, '「明日计划」必填', 400);
    for (const taskId of dto.relatedTaskIds || []) {
      const t: any = await this.prisma.workTask.findFirst({ where: { id: taskId, tenantId: tid } });
      if (!t) throw Errors.NOT_FOUND(`任务 #${taskId} 不存在`);
    }
    const dup = await this.prisma.report.findFirst({ where: { tenantId: tid, empId: c!.empId ?? -1, reportType: dto.reportType, periodStart: new Date(dto.periodStart) } });
    if (dup) throw new BusinessError(40918, '该周期已提交过报告，请勿重复提交', 409);
    const r: any = await this.prisma.report.create({ data: {
      tenantId: tid, empId: c!.empId ?? -1, reportType: dto.reportType,
      periodStart: new Date(dto.periodStart), periodEnd: new Date(dto.periodEnd),
      donePart: dto.donePart, planPart: dto.planPart, problemPart: dto.problemPart ?? null,
      relatedTaskIds: dto.relatedTaskIds ?? [],
    } });
    return { id: Number(r.id), status: r.status };
  }

  // 团队报告（manager 看下属）+ 未交名单
  async teamReports(from: string, to: string, reportType: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const subs = await this.prisma.employee.findMany({ where: { tenantId: tid, managerEmpId: c!.empId ?? -1 } });
    const reports = await this.prisma.report.findMany({ where: { tenantId: tid, reportType, periodStart: { gte: new Date(from) }, periodEnd: { lte: new Date(to) } }, orderBy: { id: 'desc' } });
    const submitted = new Set(reports.map((r: any) => Number(r.empId)));
    return {
      reports: reports.map((r: any) => ({ ...r, id: Number(r.id) })),
      missing: subs.filter((e: any) => !submitted.has(Number(e.id))).map((e: any) => ({ empId: Number(e.id), name: e.name })),
    };
  }

  // 上级点评
  async comment(id: number, text: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const r: any = await this.prisma.report.findFirst({ where: { id, tenantId: tid } });
    if (!r) throw Errors.NOT_FOUND('报告不存在');
    if (r.empId === (c!.empId ?? -1)) throw Errors.FORBIDDEN();
    await this.prisma.report.update({ where: { id }, data: { status: 'commented', commentText: text, commentByEmpId: c!.empId ?? null, commentedAt: new Date() } });
    return { id, status: 'commented' };
  }

  // FR-M12-005 考核对接：加分模式（积分×系数，封顶 cap，弃单净额可为负但总分不扣）
  async applyCredit(recordId: number, cap = 5) {
    const tid = mustCtx().tenantId;
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId, tenantId: tid } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const cfg: any = (await this.prisma.scheme.findFirst({ where: { id: task.schemeId } }))?.taskCreditConfig;
    if (!cfg?.enabled || cfg.mode !== 'credit') throw new BusinessError(40020, '方案未启用「加分模式」任务贡献', 400);
    const stat = await this.taskStatFor(Number(rec.empId), task.startDate, task.endDate);
    const raw = stat.rewardPoints * Number(cfg.rate ?? 0.1);
    const credit = Math.max(0, Math.min(Number(cfg.cap ?? cap), Number(raw.toFixed(2)))); // 封顶（UAT 11-④）
    const base = rec.finalScore != null ? Number(rec.finalScore) : 0;
    const total = Number((base + credit).toFixed(2));
    await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { finalScore: total } });
    return { recordId, taskStat: stat, rawCredit: Number(raw.toFixed(2)), creditApplied: credit, finalScore: total };
  }

  // 评价表单内嵌的过程数据卡片（参考模式 FR-M12-005）
  async statCard(recordId: number) {
    const tid = mustCtx().tenantId;
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId, tenantId: tid } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const stat = await this.taskStatFor(Number(rec.empId), task.startDate, task.endDate);
    const reports = await this.prisma.report.findMany({ where: { tenantId: tid, empId: rec.empId, periodStart: { gte: task.startDate }, periodEnd: { lte: task.endDate } } });
    const recent = reports.slice(-3).map((r: any) => ({ type: r.reportType, donePart: r.donePart.slice(0, 80) }));
    return { stat, reportCount: reports.length, recentReports: recent };
  }

  private async taskStatFor(empId: number, from: Date, to: Date) {
    const tid = mustCtx().tenantId;
    const tasks = await this.prisma.workTask.findMany({ where: { tenantId: tid, assigneeEmpId: empId, createdAt: { gte: from, lte: to } } });
    const accepted = tasks.filter((t: any) => t.status === 'accepted').length;
    const rewards = await this.prisma.rewardFlow.aggregate({ where: { tenantId: tid, empId, createdAt: { gte: from, lte: to } }, _sum: { points: true } });
    return { taskTotal: tasks.length, taskAccepted: accepted, onTimeRate: tasks.length ? Number(((accepted / tasks.length) * 100).toFixed(1)) : null, rewardPoints: Number(rewards._sum.points ?? 0) };
  }
}
