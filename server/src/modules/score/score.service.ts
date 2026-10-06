// WP-20 成绩汇总引擎（FR-M06-001）
// 总分 = Σ(客观指标得分×权重/100)【来自数据填报】 + Σ(主观指标得分×权重/100)×(评价人权重归一)
// 输出逐项计算明细（每项怎么来的、加权过程透明，供报告与校准界面展开）
import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';

export interface ScoreLine {
  indicatorId: number; indicatorName: string; weight: number; // 百分数
  source: 'data_fill' | 'review' | 'task_credit';
  selfScore?: number | null; managerScore?: number | null;
  usedScore: number; weightedScore: number; detail: string;
}

export interface AggregateResult {
  recordId: number; finalScore: number; isProvisional: boolean;
  lines: ScoreLine[];
}

@Injectable()
export class ScoreService {
  constructor(private prisma: PrismaService) {}

  async aggregate(recordId: number): Promise<AggregateResult> {
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const schemeIndicators = await this.prisma.schemeIndicator.findMany({ where: { schemeId: task.schemeId } });
    const reviewers = await this.prisma.schemeReviewer.findMany({ where: { schemeId: task.schemeId } });
    const recordIndicators = await this.prisma.recordIndicator.findMany({ where: { recordId } });

    // 评价人权重归一（主观分 = 自评×w1 + 上级评×w2，权重归一到合计 100）
    const active = reviewers.filter((r: any) => Number(r.weight) > 0);
    const wSum = active.reduce((a: number, r: any) => a + Number(r.weight), 0) || 1;
    const reviewerWeight: Record<string, number> = {};
    for (const r of active) reviewerWeight[r.reviewerType] = Number(r.weight) / wSum;

    const lines: ScoreLine[] = [];
    let total = 0;
    let provisional = false;

    for (const ri of recordIndicators) {
      const si: any = schemeIndicators.find((x: any) => Number(x.indicatorId) === Number(ri.indicatorId));
      const weight = si ? Number(si.weight) : 0;
      const ind: any = await this.prisma.indicator.findFirst({ where: { id: ri.indicatorId } });
      const name = ind?.name ?? `指标#${ri.indicatorId}`;

      if (ri.scoreSource === 'data_fill') {
        // 客观：唯一写入口是数据填报，weightedScore 已带权重；autoScore 在填报行上
        const ws = ri.weightedScore != null ? Number(ri.weightedScore) : 0;
        if (ri.weightedScore == null) provisional = true; // 未填报行 → 待定
        let auto: number | null = null;
        if (ri.dataFillItemId != null) {
          const item: any = await this.prisma.dataFillItem.findFirst({ where: { id: ri.dataFillItemId } });
          auto = item?.autoScore != null ? Number(item.autoScore) : null;
        }
        const fallback = weight > 0 ? ws / (weight / 100) : 0;
        const used = auto ?? (ws > 0 ? fallback : null);
        total += ws;
        lines.push({
          indicatorId: Number(ri.indicatorId), indicatorName: name, weight, source: 'data_fill',
          usedScore: used ?? 0,
          weightedScore: ws,
          detail: used == null ? `系统自动计分 待定 × 权重 ${weight}% = ${ws.toFixed(2)}（待填报）` : `系统自动计分 ${used} × 权重 ${weight}% = ${ws.toFixed(2)}`,
        });
      } else {
        // 主观：自评/上级评加权
        const selfW = reviewerWeight['self'] ?? 0;
        const mgrW = reviewerWeight['manager'] ?? (1 - selfW);
        const self = ri.selfScore != null ? Number(ri.selfScore) : null;
        const mgr = ri.managerScore != null ? Number(ri.managerScore) : null;
        let used = 0; const parts: string[] = [];
        if (self != null) { used += self * selfW; parts.push(`自评 ${self}×${(selfW * 100).toFixed(0)}%`); }
        if (mgr != null) { used += mgr * mgrW; parts.push(`上级评 ${mgr}×${(mgrW * 100).toFixed(0)}%`); }
        if (self == null && mgr == null) provisional = true;
        const ws = (used * weight) / 100;
        total += ws;
        lines.push({
          indicatorId: Number(ri.indicatorId), indicatorName: name, weight, source: 'review',
          selfScore: self, managerScore: mgr, usedScore: Number(used.toFixed(2)), weightedScore: Number(ws.toFixed(2)),
          detail: `${parts.join(' + ') || '待定'} = ${used.toFixed(2)} × 权重 ${weight}% = ${ws.toFixed(2)}`,
        });
      }
    }

    const finalScore = Number(total.toFixed(2));
    await this.prisma.assessmentRecord.update({
      where: { id: recordId },
      data: { finalScore, isProvisional: provisional },
    });
    return { recordId, finalScore, isProvisional: provisional, lines };
  }

  // 任务级批量汇总 + 经理视角排名
  async rankByTask(taskId: number) {
    await this.assertTaskReady(taskId);
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId }, orderBy: { finalScore: 'desc' } });
    return Promise.all(records.map(async (r: any) => {
      const emp: any = await this.prisma.employee.findFirst({ where: { id: r.empId } });
      return { recordId: Number(r.id), employeeName: emp?.name ?? `#${r.empId}`, finalScore: r.finalScore != null ? Number(r.finalScore) : null, isProvisional: r.isProvisional, status: r.status };
    }));
  }

  private async assertTaskReady(taskId: number) {
    const left = await this.prisma.assessmentRecord.count({ where: { taskId, status: { in: ['goal_setting', 'goal_approval', 'data_fill', 'self_review', 'peer_review', 'manager_review'] } } });
    if (left > 0) throw new (require('../../common/errors').BusinessError)(40906, `尚有 ${left} 张考核单未完成评价，不能汇总排名`, 409);
  }
}
