// WP-21 校准与强制分布（FR-M06-002/003）
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

@Injectable()
export class CalibrateService {
  constructor(private prisma: PrismaService) {}

  // 给考核单定级（含强制分布校验 40002）；跨范围调整须填理由并全程留痕（FR-M06-003）
  async assignGrade(recordId: number, grade: string, reason?: string) {
    const tid = mustCtx().tenantId;
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    if (rec.status !== 'calibrating') throw new BusinessError(40907, '仅「校准中」状态可定级', 409);
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const rules = await this.prisma.schemeGradeRule.findMany({ where: { schemeId: task.schemeId } });
    const rule = rules.find((r: any) => r.grade === grade);
    if (!rule) throw new BusinessError(40007, `等级「${grade}」不在方案等级规则内`, 400);

    // 强制分布校验（FR-M06-002）：该等级占比不得超 ratioLimit（40002）
    if (rule.ratioLimit != null) {
      const [total, inGrade] = await Promise.all([
        this.prisma.assessmentRecord.count({ where: { taskId: rec.taskId } }),
        this.prisma.assessmentRecord.count({ where: { taskId: rec.taskId, grade } }),
      ]);
      const meInGrade = rec.grade === grade;
      if (!meInGrade && total > 0 && (inGrade + 1) / total > Number(rule.ratioLimit) / 100) {
        throw new BusinessError(40002, `等级 ${grade} 超出强制分布上限 ${rule.ratioLimit}%（当前 ${inGrade}/${total}）`, 400);
      }
    }

    // 跨范围调整：操作者不是该员工所在部门管理者（managerEmpId 不匹配）→ 理由必填 + 审计留痕
    const c = ctx();
    if (c?.empId && rec.managerEmpId != null && Number(rec.managerEmpId) !== c.empId) {
      if (!reason || reason.trim().length < 2) {
        throw new BusinessError(40009, '跨团队调整必须填写理由（≥2 字）', 400);
      }
    }

    // 分数须落在等级区间（校准可微调，但不能越档无痕迹）
    if (rec.finalScore != null) {
      const sc = Number(rec.finalScore);
      if (sc < Number(rule.minScore) || sc > Number(rule.maxScore)) {
        throw new BusinessError(40008, `得分 ${sc} 不在等级 ${grade} 区间 [${rule.minScore}, ${rule.maxScore}]`, 400);
      }
    }

    await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { grade } });
    await this.prisma.recordStatusLog.create({ data: {
      tenantId: tid, recordId, fromStatus: 'calibrating', toStatus: 'calibrating',
      operatorEmpId: c?.empId ?? null, note: `定级 ${grade}${reason ? `（${reason}）` : ''}`,
    } });
    return { id: recordId, grade };
  }

  // 等级分布快照（校准界面用）
  async distribution(taskId: number) {
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId }, select: { grade: true } });
    const dist: Record<string, number> = {};
    for (const r of records) dist[r.grade || '未定级'] = (dist[r.grade || '未定级'] || 0) + 1;
    return { total: records.length, distribution: dist };
  }
}
