// WP-14 指标数据填报（FR-M05-008 全部）：出数拆单 + 口径固化 + 自动计分 + 防倒推 + 异议复核 + 超期兜底
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { mustCtx } from '../../tenant-context';
import { BusinessError, Errors } from '../../common/errors';
import { deriveStatWindow, autoScore } from '../../lib/stat-window';

const ERR2 = {
  NOT_FILLER: () => new BusinessError(40301, '您不是该出数部门的填报人', 403),
  ORDER_NOT_EDITABLE: () => new BusinessError(40906, '工作单已提交，如需修改请 HR 退回重填', 409),
  ITEM_NOT_FILLED: () => new BusinessError(40017, '该填报行尚未填报，不能提异议'),
  NOT_OWNER: () => new BusinessError(40302, '只能对本人的考核数据提出异议', 403),
  OBJ_NOT_PENDING: () => new BusinessError(40907, '该异议已复核完毕', 409),
  PUBLISH_BLOCKED: () => new BusinessError(40018, '存在未结异议的客观指标，处理完毕后才能发布结果'),
};

@Injectable()
export class DataFillService {
  constructor(private prisma: PrismaService) {}

  // 任务发起时：按出数部门拆分填报工作单 + 生成填报行（固化口径快照）（FR-M05-008 AC1/AC6/AC7）
  async spawnOrders(tx: any, p: {
    task: { id: bigint; startDate: Date; endDate: Date }; nodes: any[]; records: { id: bigint; empId: bigint; hireDate: Date }[];
    indicators: { schemeIndicator: any; detail: any }[];
  }) {
    const tid = mustCtx().tenantId;
    const fillEnabled = p.nodes.some((n) => n.nodeType === 'data_fill' && n.enabled);
    if (!fillEnabled) return;
    const objective = p.indicators.filter((i) => i.detail.sourceType === 'dept_report' && i.detail.dataOwnerDeptId);
    if (objective.length === 0) return;
    const byDept = new Map<number, any[]>();
    for (const i of objective) {
      const deptId = Number(i.detail.dataOwnerDeptId);
      byDept.set(deptId, [...(byDept.get(deptId) || []), i]);
    }
    for (const [deptId, inds] of byDept) {
      // 填报人：优先部门填报人，未设回落部门负责人（FR-M02-004）
      let filler: any = await this.prisma.deptDataFiller.findFirst({ where: { deptId }, orderBy: { isPrimary: 'desc' } });
      let fillerEmpId: bigint | null = filler ? filler.fillerEmpId : null;
      if (!fillerEmpId) {
        const dept: any = await this.prisma.department.findFirst({ where: { id: deptId } });
        if (dept?.managerUserId) {
          const emp: any = await this.prisma.employee.findFirst({ where: { userId: dept.managerUserId } });
          fillerEmpId = emp?.id ?? null;
        }
      }
      const totalRows = inds.length * p.records.length;
      const order = await tx.dataFillOrder.create({
        data: { tenantId: tid, taskId: p.task.id, dataOwnerDeptId: deptId, fillerEmpId, totalRows },
      });
      for (const rec of p.records) {
        for (const i of inds) {
          // AC6/AC7：行级固化口径与统计窗口快照（后续指标改口径不影响历史行）
          const w = deriveStatWindow({
            statScope: i.detail.statScope as any,
            cumulativeFrom: i.detail.cumulativeFrom as any,
            periodStart: p.task.startDate, periodEnd: p.task.endDate,
            taskStart: p.task.startDate,
            hireDate: rec.hireDate,
          });
          await tx.dataFillItem.create({
            data: {
              tenantId: tid, orderId: order.id, recordId: rec.id, indicatorId: i.detail.id,
              targetValue: i.schemeIndicator.defaultTarget ?? null,
              statScope: i.detail.statScope,
              statWindowStart: w.start, statWindowEnd: w.end,
            },
          });
        }
      }
    }
  }

  private async mustOrder(id: number) {
    const o = await this.prisma.dataFillOrder.findFirst({ where: { id } });
    if (!o) throw Errors.NOT_FOUND('填报工作单不存在');
    return o;
  }
  private async assertFiller(order: any) {
    const c = mustCtx();
    if (c.roles.includes('hr_admin') || c.roles.includes('super_admin')) return;
    if (!order.fillerEmpId || Number(order.fillerEmpId) !== c.empId) throw ERR2.NOT_FILLER();
  }

  async listOrders(q: { taskId?: number; status?: string }) {
    const where: any = {};
    if (q.taskId) where.taskId = q.taskId;
    if (q.status) where.status = q.status;
    const c = mustCtx();
    if (!c.roles.includes('hr_admin') && !c.roles.includes('super_admin')) where.fillerEmpId = c.empId ?? -1;
    const list = await this.prisma.dataFillOrder.findMany({ where, orderBy: { id: 'desc' } });
    return Promise.all(list.map(async (o) => {
      const t: any = await this.prisma.assessmentTask.findFirst({ where: { id: o.taskId } });
      const dept: any = await this.prisma.department.findFirst({ where: { id: o.dataOwnerDeptId } });
      const filler: any = await this.prisma.employee.findFirst({ where: { id: o.fillerEmpId } });
      return { ...o, id: Number(o.id), taskId: Number(o.taskId),
        taskName: t?.name ?? `任务#${o.taskId}`, deptName: dept?.name ?? `部门#${o.dataOwnerDeptId}`, fillerName: filler?.name ?? '—' };
    }));
  }

  async getOrder(id: number) {
    const o = await this.mustOrder(id);
    await this.assertFiller(o);
    const items = await this.prisma.dataFillItem.findMany({ where: { orderId: id }, orderBy: [{ recordId: 'asc' }, { indicatorId: 'asc' }] });
    return {
      ...o, id: Number(o.id), taskId: Number(o.taskId),
      items: await Promise.all(items.map(async (i) => {
        const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: i.recordId } });
        const emp: any = rec ? await this.prisma.employee.findFirst({ where: { id: rec.empId } }) : null;
        const ind: any = await this.prisma.indicator.findFirst({ where: { id: i.indicatorId } });
        const ri: any = await this.prisma.recordIndicator.findFirst({ where: { recordId: i.recordId, indicatorId: i.indicatorId } });
        const obj: any = await this.prisma.indicatorObjection.findFirst({ where: { dataFillItemId: i.id, status: 'PENDING' } });
        const w0 = i.statWindowStart ? fmtDate(i.statWindowStart) : null;
        const w1 = i.statWindowEnd ? fmtDate(i.statWindowEnd) : null;
        return {
          ...i, id: Number(i.id), recordId: Number(i.recordId), indicatorId: Number(i.indicatorId),
          employeeName: emp?.name ?? `#${i.recordId}`, indicatorName: ind?.name ?? `#${i.indicatorId}`,
          targetValue: ri?.targetValue != null ? Number(ri.targetValue) : null,
          actualValue: i.actualValue != null ? Number(i.actualValue) : null,
          autoScore: i.autoScore != null ? Number(i.autoScore) : null,
          hasObjection: !!obj,
          statWindowStart: w0, statWindowEnd: w1,
          windowLabel: w0 && w1 ? `取数范围 ${w0} ~ ${w1}` : '—',
        };
      })),
    };
  }

  // 整单提交：按行计分 → 写 record_indicator（score_source=data_fill）→ 自动加权（AC2）
  async submitOrder(id: number, items: { recordId: number; indicatorId: number; actualValue: number; evidenceNote?: string; evidenceFileUrl?: string }[]) {
    const order = await this.mustOrder(id);
    await this.assertFiller(order);
    if (order.status === 'SUBMITTED') throw ERR2.ORDER_NOT_EDITABLE();
    const tid = mustCtx().tenantId;
    const c = mustCtx();
    await this.prisma.$transaction(async (tx) => {
      for (const it of items) {
        const row = await tx.dataFillItem.findFirst({ where: { orderId: id, recordId: it.recordId, indicatorId: it.indicatorId } });
        if (!row) throw Errors.NOT_FOUND(`填报行不存在：record ${it.recordId} × 指标 ${it.indicatorId}`);
        const ind: any = await this.prisma.indicator.findFirst({ where: { id: it.indicatorId } });
        const rule = (ind.scoreRule as any) || { type: 'rate', base: 100, cap: 120, floor: 0 };
        const score = autoScore(rule, Number(row.targetValue ?? 0), Number(it.actualValue));
        await tx.dataFillItem.update({
          where: { id: row.id },
          data: { actualValue: it.actualValue, evidenceNote: it.evidenceNote ?? null, evidenceFileUrl: it.evidenceFileUrl ?? null, autoScore: score, scoreSource: 'data_fill', filledAt: new Date(), filledByEmpId: c.empId ?? null, settled: true, defaultApplied: false },
        });
        // 写回考核单指标得分（覆盖式，退回重填后重交以此为准）
        const ri: any = await tx.recordIndicator.findFirst({ where: { recordId: it.recordId, indicatorId: it.indicatorId } });
        const weight = ri ? await this.weightOf(Number(ri.recordId), it.indicatorId) : 0;
        if (ri) {
          await tx.recordIndicator.update({
            where: { id: ri.id },
            data: { scoreSource: 'data_fill', weightedScore: Math.round(score * weight) / 100, dataFillItemId: row.id },
          });
        }
      }
      const filled = await tx.dataFillItem.count({ where: { orderId: id, settled: true } });
      await tx.dataFillOrder.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), filledRows: filled } });
    });
    return this.getOrder(id);
  }

  private async weightOf(recordId: number, indicatorId: number): Promise<number> {
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) return 0;
    const t: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const si: any = await this.prisma.schemeIndicator.findFirst({ where: { schemeId: t.schemeId, indicatorId } });
    return si ? Number(si.weight) : 0;
  }

  // HR 退回重填（原因必填，审计扩展自动留痕）
  async returnOrder(id: number, reason: string) {
    if (!reason?.trim()) throw new BusinessError(40019, '退回原因必填');
    const order = await this.mustOrder(id);
    const updated = await this.prisma.dataFillOrder.update({ where: { id }, data: { status: 'RETURNED', returnReason: reason } });
    return { id: Number(updated.id), status: updated.status };
  }

  // 超期兜底：未填行按方案规则计默认分（默认 0 分，AC4）
  async settleOrder(id: number) {
    const order = await this.mustOrder(id);
    const tid = mustCtx().tenantId;
    await this.prisma.$transaction(async (tx) => {
      const unfilled = await tx.dataFillItem.findMany({ where: { orderId: id, settled: false } });
      for (const row of unfilled) {
        await tx.dataFillItem.update({
          where: { id: row.id },
          data: { autoScore: 0, scoreSource: 'data_fill', settled: true, defaultApplied: true, filledAt: new Date() },
        });
        const ri: any = await tx.recordIndicator.findFirst({ where: { recordId: row.recordId, indicatorId: row.indicatorId } });
        if (ri) await tx.recordIndicator.update({ where: { id: ri.id }, data: { scoreSource: 'data_fill', weightedScore: 0 } });
      }
      await tx.dataFillOrder.update({ where: { id }, data: { status: 'SETTLED', filledRows: order.totalRows } });
    });
    return this.getOrder(id);
  }

  // 员工异议（填报完成后、自评阶段可对客观指标填报值提异议，AC3）
  async raiseObjection(itemId: number, reason: string, evidenceFileUrl?: string) {
    if (!reason?.trim()) throw new BusinessError(40020, '异议理由必填');
    const item = await this.prisma.dataFillItem.findFirst({ where: { id: itemId } });
    if (!item) throw Errors.NOT_FOUND('填报行不存在');
    if (item.actualValue === null || !item.settled) throw ERR2.ITEM_NOT_FILLED();
    const c = mustCtx();
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: item.recordId } });
    if (!c.empId || Number(rec.empId) !== c.empId) throw ERR2.NOT_OWNER();
    const tid = mustCtx().tenantId;
    const obj = await this.prisma.indicatorObjection.create({
      data: { tenantId: tid, dataFillItemId: item.id, recordId: item.recordId, raisedByEmpId: c.empId, reason, evidenceFileUrl: evidenceFileUrl ?? null, oldValue: item.actualValue },
    });
    await this.prisma.assessmentRecord.update({ where: { id: item.recordId }, data: { isProvisional: true } });
    return { id: Number(obj.id), status: obj.status };
  }

  // 填报人复核：维持 / 修正（修正重算得分，全程留痕）
  async handleObjection(id: number, dto: { result: 'keep' | 'fix'; newValue?: number; comment?: string }) {
    const obj = await this.prisma.indicatorObjection.findFirst({ where: { id } });
    if (!obj) throw Errors.NOT_FOUND('异议不存在');
    if (obj.status !== 'PENDING') throw ERR2.OBJ_NOT_PENDING();
    const c = mustCtx();
    const tid = mustCtx().tenantId;
    await this.prisma.$transaction(async (tx) => {
      if (dto.result === 'fix') {
        if (dto.newValue === undefined || dto.newValue === null) throw new BusinessError(40021, '修正时必须提供新值');
        const item: any = await tx.dataFillItem.findFirst({ where: { id: obj.dataFillItemId } });
        const ind: any = await this.prisma.indicator.findFirst({ where: { id: item.indicatorId } });
        const rule = (ind.scoreRule as any) || { type: 'rate', base: 100, cap: 120, floor: 0 };
        const score = autoScore(rule, Number(item.targetValue ?? 0), Number(dto.newValue));
        await tx.dataFillItem.update({ where: { id: item.id }, data: { actualValue: dto.newValue, autoScore: score } });
        const ri: any = await tx.recordIndicator.findFirst({ where: { recordId: obj.recordId, indicatorId: item.indicatorId } });
        const weight = await this.weightOf(Number(obj.recordId), Number(item.indicatorId));
        if (ri) await tx.recordIndicator.update({ where: { id: ri.id }, data: { weightedScore: Math.round(score * weight) / 100 } });
        await tx.indicatorObjection.update({ where: { id }, data: { status: 'FIXED', newValue: dto.newValue, handlerEmpId: c.empId ?? null, handledAt: new Date() } });
      } else {
        await tx.indicatorObjection.update({ where: { id }, data: { status: 'KEPT', handlerEmpId: c.empId ?? null, handledAt: new Date() } });
      }
      // 重算待定标记：该考核单是否还有未结异议
      const pending = await tx.indicatorObjection.count({ where: { recordId: obj.recordId, status: 'PENDING' } });
      await tx.assessmentRecord.update({ where: { id: obj.recordId }, data: { isProvisional: pending > 0 } });
    });
    return { id, status: dto.result === 'fix' ? 'FIXED' : 'KEPT' };
  }

  // 未结异议存在时禁止发布（FR-M06-004 拦截，UAT 8-④）
  async assertNoPendingObjections(taskId: number) {
    const recs = await this.prisma.assessmentRecord.findMany({ where: { taskId }, select: { id: true } });
    const ids = recs.map((r) => r.id);
    if (ids.length === 0) return;
    const pending = await this.prisma.indicatorObjection.count({ where: { recordId: { in: ids }, status: 'PENDING' } });
    if (pending > 0) throw ERR2.PUBLISH_BLOCKED();
  }
}

function fmtDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
