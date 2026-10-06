// WP-23/24 周期关联汇总（FR-M03-005 / FR-M05-009）
// 三种模式：weighted 加权汇入 / reference 参考展示 / point 积分映射
// 缺期策略：renormalize 折算（默认）/ default_score 缺省分 / manual 人工待办
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { mustCtx } from '../../tenant-context';

@Injectable()
export class RollupService {
  constructor(private prisma: PrismaService) {}

  // 推荐可关联任务：同方案、已 FINISHED（FR-M05-009 AC1）
  async linkable(schemeId: number, excludeTaskId?: number) {
    const list = await this.prisma.assessmentTask.findMany({
      where: { schemeId, status: 'FINISHED', isDeleted: false, ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}) },
      orderBy: { id: 'asc' },
    });
    return list.map((t: any) => ({ id: Number(t.id), name: t.name, period: t.period, endDate: t.endDate }));
  }

  // 生成/重算某考核单的周期关联明细与总分（weighted 时改写 finalScore）
  async computeRollup(recordId: number) {
    const tid = mustCtx().tenantId;
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const linkedIds: number[] = (task.linkedTaskIds as any) || [];
    const cfg: any = (await this.prisma.scheme.findFirst({ where: { id: task.schemeId } }))?.linkageConfig;
    if (!linkedIds.length || !cfg?.enabled) {
      return { recordId, mode: null, note: '本任务未配置周期关联', rollupDetail: rec.rollupDetail ?? null, finalScore: rec.finalScore != null ? Number(rec.finalScore) : null };
    }
    const mode = cfg.mode || 'weighted';

    // 逐期取该员工在关联任务中的考核单
    const periods: any[] = [];
    for (const lid of linkedIds) {
      const lt: any = await this.prisma.assessmentTask.findFirst({ where: { id: Number(lid) } });
      const sub: any = await this.prisma.assessmentRecord.findFirst({ where: { taskId: Number(lid), empId: rec.empId } });
      const wCfg = (cfg.periodWeights || []).find((p: any) => Number(p.taskId) === Number(lid));
      periods.push({
        taskId: Number(lid), period: lt?.period ?? `任务#${lid}`,
        score: sub?.finalScore != null ? Number(sub.finalScore) : null,
        grade: sub?.grade ?? null,
        weight: wCfg?.weight ?? 0,
        missing: !sub || sub.finalScore == null,
      });
    }

    let finalScore: number | null = null;

    if (mode === 'weighted') {
      const selfRatio = Number(cfg.selfRatio ?? 0);
      const selfScore = rec.finalScore != null ? Number(rec.finalScore) : null;
      const policy = cfg.missingPolicy || 'renormalize';
      const available = periods.filter((p) => !p.missing);
      const missing = periods.filter((p) => p.missing);
      const wSum = available.reduce((a, p) => a + p.weight, 0);

      let linkedSum = 0;
      if (policy === 'renormalize' && wSum > 0) {
        for (const p of available) {
          p.effectiveWeight = (p.weight / wSum) * (100 - selfRatio); // 缺期权重折算到在期
          linkedSum += (p.score as number) * (p.effectiveWeight / 100);
        }
      } else if (policy === 'default_score') {
        for (const p of periods) {
          p.effectiveWeight = p.weight;
          linkedSum += (p.missing ? Number(cfg.defaultScore ?? 0) : (p.score as number)) * (p.weight / 100);
        }
      } else { // manual：缺期不折算，产生待办
        for (const p of available) { p.effectiveWeight = p.weight; linkedSum += (p.score as number) * (p.weight / 100); }
        if (missing.length) {
          const hrs = await this.prisma.user.findMany({ where: { tenantId: tid, roles: { hasSome: ['hr_admin'] } } });
          for (const u of hrs) {
            await this.prisma.todo.create({ data: { tenantId: tid, userId: u.id, bizType: 'rollup_missing', bizId: String(recordId), title: `周期关联缺期处理：考核单 #${recordId}`, actionUrl: `/records/${recordId}` } });
          }
        }
      }
      const selfPart = selfScore != null ? selfScore * (selfRatio / 100) : 0;
      finalScore = Number((linkedSum + selfPart).toFixed(2));
      for (const p of periods) p.note = p.missing ? `缺期（${policy}）` : undefined;
      await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { finalScore, rollupDetail: { mode, selfRatio, periods } } });
    } else if (mode === 'reference') {
      // 参考展示：不改动 finalScore，只落明细
      await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { rollupDetail: { mode, periods } } });
      finalScore = rec.finalScore != null ? Number(rec.finalScore) : null;
    } else if (mode === 'point') {
      // 积分映射：等级→积分累计，按积分段定级
      const pointMap: Record<string, number> = Object.fromEntries((cfg.pointMap || []).map((m: any) => [m.grade, Number(m.point)]));
      let points = 0;
      for (const p of periods) { p.point = p.grade != null ? (pointMap[p.grade] ?? 0) : 0; points += p.point; }
      const band = (cfg.gradeBands || []).find((b: any) => points >= Number(b.min) && points <= Number(b.max));
      await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { rollupDetail: { mode, totalPoints: points, periods }, grade: band?.grade ?? rec.grade } });
      finalScore = rec.finalScore != null ? Number(rec.finalScore) : null;
    }

    const fresh: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    return { recordId, mode, rollupDetail: fresh.rollupDetail, finalScore: fresh.finalScore != null ? Number(fresh.finalScore) : null };
  }

  // 关联期得分修订后的联动重算（FR-M03-005：自动重算并通知 HR）
  async recalc(recordId: number) {
    const r = await this.computeRollup(recordId);
    const tid = mustCtx().tenantId;
    const hrs = await this.prisma.user.findMany({ where: { tenantId: tid, roles: { hasSome: ['hr_admin'] } } });
    for (const u of hrs) {
      await this.prisma.message.create({ data: { tenantId: tid, userId: u.id, bizType: 'rollup_recalc', title: '周期关联得分已重算', content: `考核单 #${recordId} 因关联期得分修订已自动重算，请复核` } });
    }
    return r;
  }
}
