// WP-16 目标制定/审批 + 自评 + 上级评价（FR-M05-002/003/004）
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { mustCtx } from '../../tenant-context';
import { BusinessError, Errors } from '../../common/errors';
import { TaskService } from '../task/task.service';
import { enabledChain } from '../../lib/state-machine';

const ERR3 = {
  NOT_OWNER: () => new BusinessError(40303, '只能操作本人的考核单', 403),
  NOT_MANAGER: () => new BusinessError(40304, '只能评价本人的直接下属', 403),
  OBJECTIVE_FORBIDDEN: () => new BusinessError(40305, '客观指标得分由出数部门填报生成，不可打分', 403),
  SELF_LOCKED: () => new BusinessError(40909, '自评已提交并锁定，不可修改', 409),
  GOAL_NOT_NEEDED: () => new BusinessError(40910, '当前节点无需提交目标', 409),
};

@Injectable()
export class ReviewService {
  constructor(private prisma: PrismaService, private tasks: TaskService) {}

  private async mustRecord(recordId: number) {
    const rec = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    return rec;
  }
  private assertOwner(rec: any) {
    const c = mustCtx();
    if (!c.roles.includes('hr_admin') && (!c.empId || Number(rec.empId) !== c.empId)) throw ERR3.NOT_OWNER();
  }
  private async assertManager(rec: any) {
    const c = mustCtx();
    if (c.roles.includes('hr_admin')) return;
    if (!c.empId || Number(rec.managerEmpId) !== c.empId) throw ERR3.NOT_MANAGER();
  }
  private async objectiveIds(recordId: number): Promise<Set<number>> {
    const ris = await this.prisma.recordIndicator.findMany({ where: { recordId }, select: { indicatorId: true } });
    const inds = await this.prisma.indicator.findMany({
      where: { id: { in: ris.map((r) => r.indicatorId) } },
      select: { id: true, sourceType: true },
    });
    return new Set(inds.filter((i) => i.sourceType === 'dept_report' || i.sourceType === 'auto_system').map((i) => Number(i.id)));
  }
  private async enabledNodes(recordId: number) {
    const rec = await this.mustRecord(recordId);
    const task = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const nodes = await this.prisma.schemeNode.findMany({ where: { schemeId: task.schemeId } });
    return nodes.map((n) => ({ nodeType: n.nodeType, enabled: n.enabled }));
  }
  private nextOf(nodes: { nodeType: string; enabled: boolean }[], current: string): string | null {
    const chain = enabledChain(nodes);
    const i = chain.indexOf(current);
    return i >= 0 && i < chain.length - 1 ? chain[i + 1] : null;
  }

  // FR-M05-002 目标提交：写目标值并同步未填报行；无审批节点则直接推进
  async submitGoal(recordId: number, targets: { indicatorId: number; targetValue: number }[]) {
    const rec = await this.mustRecord(recordId);
    this.assertOwner(rec);
    if (rec.status !== 'goal_setting') throw ERR3.GOAL_NOT_NEEDED();
    await this.prisma.$transaction(async (tx) => {
      for (const t of targets) {
        const ri: any = await tx.recordIndicator.findFirst({ where: { recordId, indicatorId: t.indicatorId } });
        if (!ri) throw Errors.NOT_FOUND(`指标 ${t.indicatorId} 不在本考核单中`);
        await tx.recordIndicator.update({ where: { id: ri.id }, data: { targetValue: t.targetValue } });
        // 同步未填报的填报行目标值
        await tx.dataFillItem.updateMany({
          where: { recordId, indicatorId: t.indicatorId, settled: false },
          data: { targetValue: t.targetValue },
        });
      }
      await tx.assessmentRecord.update({ where: { id: recordId }, data: { goalSubmittedAt: new Date() } });
    });
    const nodes = await this.enabledNodes(recordId);
    const hasApproval = nodes.some((n) => n.nodeType === 'goal_approval' && n.enabled);
    if (!hasApproval) {
      const next = this.nextOf(nodes, 'goal_setting');
      if (next) return this.tasks.advance(recordId, next, '员工提交目标');
    } else {
      // 生成经理审批待办
      const c = mustCtx();
      const tid = c.tenantId;
      const mgrUser = await this.userOfEmp(Number(rec.managerEmpId));
      if (mgrUser) {
        await this.prisma.todo.create({
          data: { tenantId: tid, userId: mgrUser, bizType: 'goal_approval', bizId: String(recordId), title: '目标待审批', actionUrl: `/records/${recordId}` },
        });
      }
      return { id: recordId, status: 'goal_setting', pending: 'approval' };
    }
    return { id: recordId, status: (await this.mustRecord(recordId)).status };
  }

  // 目标审批（通过 → 推进；驳回附意见 → 待办回员工，全程留痕）
  async approveGoal(recordId: number, pass: boolean, comment?: string) {
    const rec = await this.mustRecord(recordId);
    await this.assertManager(rec);
    if (rec.status !== 'goal_setting') throw ERR3.GOAL_NOT_NEEDED();
    if (!pass && !comment?.trim()) throw new BusinessError(40022, '驳回必须填写意见');
    const c = mustCtx();
    if (!pass) {
      const ownerUser = await this.userOfEmp(Number(rec.empId));
      if (ownerUser) {
        await this.prisma.todo.create({
          data: { tenantId: c.tenantId, userId: ownerUser, bizType: 'goal_rejected', bizId: String(recordId), title: `目标被驳回：${comment}`, actionUrl: `/records/${recordId}` },
        });
      }
      await this.prisma.recordStatusLog.create({
        data: { tenantId: c.tenantId, recordId, fromStatus: 'goal_setting', toStatus: 'goal_setting', operatorEmpId: c.empId ?? null, note: `目标驳回：${comment}` },
      });
      return { id: recordId, status: 'goal_setting', rejected: true };
    }
    const nodes = await this.enabledNodes(recordId);
    const hasApproval = nodes.some((n) => n.nodeType === 'goal_approval' && n.enabled);
    if (hasApproval) {
      // 先合法进入审批节点（留痕），再瞬时完成审批进入下一节点
      const mid = this.nextOf(nodes, 'goal_setting');
      if (mid && mid !== 'goal_approval') return this.tasks.advance(recordId, mid, '目标审批通过');
      await this.tasks.advance(recordId, 'goal_approval', '目标进入审批');
      const next = this.nextOf(nodes, 'goal_approval');
      if (next) return this.tasks.advance(recordId, next, '目标审批通过');
      return { id: recordId, status: (await this.mustRecord(recordId)).status };
    }
    const next = this.nextOf(nodes, 'goal_setting');
    if (next) return this.tasks.advance(recordId, next, '目标审批通过');
    return { id: recordId, status: (await this.mustRecord(recordId)).status };
  }

  // FR-M05-003 自评：仅主观/自报指标可打分；提交即锁定并推进
  async submitSelfReview(recordId: number, scores: { indicatorId: number; score: number; comment?: string }[], summary?: string) {
    const rec = await this.mustRecord(recordId);
    this.assertOwner(rec);
    if (rec.status !== 'self_review') throw new BusinessError(40911, '当前节点不是自评', 409);
    if (rec.selfSubmittedAt) throw ERR3.SELF_LOCKED();
    const objective = await this.objectiveIds(recordId);
    for (const s of scores) {
      if (objective.has(Number(s.indicatorId))) throw ERR3.OBJECTIVE_FORBIDDEN();
    }
    await this.prisma.$transaction(async (tx) => {
      for (const s of scores) {
        const ri: any = await tx.recordIndicator.findFirst({ where: { recordId, indicatorId: s.indicatorId } });
        if (!ri) throw Errors.NOT_FOUND(`指标 ${s.indicatorId} 不在本考核单中`);
        await tx.recordIndicator.update({ where: { id: ri.id }, data: { selfScore: s.score, selfComment: s.comment ?? null } });
      }
      await tx.assessmentRecord.update({ where: { id: recordId }, data: { selfSummary: summary ?? null, selfSubmittedAt: new Date() } });
    });
    const nodes = await this.enabledNodes(recordId);
    const next = this.nextOf(nodes, 'self_review');
    if (next) return this.tasks.advance(recordId, next, '员工提交自评');
    return { id: recordId, status: (await this.mustRecord(recordId)).status };
  }

  // FR-M05-004 上级评价：仅主观指标可打分（客观分一律 403）；提交即推进到校准
  async submitManagerReview(recordId: number, scores: { indicatorId: number; score: number; comment?: string }[]) {
    const rec = await this.mustRecord(recordId);
    await this.assertManager(rec);
    if (rec.status !== 'manager_review') throw new BusinessError(40912, '当前节点不是上级评价', 409);
    const objective = await this.objectiveIds(recordId);
    for (const s of scores) {
      if (objective.has(Number(s.indicatorId))) throw ERR3.OBJECTIVE_FORBIDDEN(); // UAT 8-②
    }
    await this.prisma.$transaction(async (tx) => {
      for (const s of scores) {
        const ri: any = await tx.recordIndicator.findFirst({ where: { recordId, indicatorId: s.indicatorId } });
        if (!ri) throw Errors.NOT_FOUND(`指标 ${s.indicatorId} 不在本考核单中`);
        await tx.recordIndicator.update({ where: { id: ri.id }, data: { managerScore: s.score, managerComment: s.comment ?? null } });
      }
      // 经理评价完成 → 其评价人记录置已评
      const c = mustCtx();
      if (c.empId) {
        await tx.recordReviewer.updateMany({
          where: { recordId, reviewerEmpId: c.empId, reviewerType: 'manager' },
          data: { status: '已评', submittedAt: new Date() },
        });
      }
    });
    const nodes = await this.enabledNodes(recordId);
    const next = this.nextOf(nodes, 'manager_review');
    if (next) return this.tasks.advance(recordId, next, '上级提交评价');
    return { id: recordId, status: (await this.mustRecord(recordId)).status };
  }

  private async userOfEmp(empId: number): Promise<number | null> {
    if (!empId) return null;
    const e: any = await this.prisma.employee.findFirst({ where: { id: empId }, select: { userId: true } });
    return e?.userId ? Number(e.userId) : null;
  }
}
