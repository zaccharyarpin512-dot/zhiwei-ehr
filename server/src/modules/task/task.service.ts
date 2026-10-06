// M05 考核任务服务（FR-M05-001 + PRD 7.1/7.2 + FR-M01-003 组织快照）
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { mustCtx } from '../../tenant-context';
import { BusinessError, Errors } from '../../common/errors';
import { canTransit, initialStatus } from '../../lib/state-machine';
import { DataFillService } from '../datafill/datafill.service';
import { ctx } from '../../tenant-context';

@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService, private dataFill: DataFillService) {}

  // 发起考核任务：人群快照批量生成考核单 + 首节点待办
  async create(dto: { schemeId: number; name: string; period: string; startDate: string; endDate: string; linkedTaskIds?: number[]; scopeFilter?: any; asDraft?: boolean }) {
    const tid = mustCtx().tenantId;
    const scheme: any = await this.prisma.scheme.findFirst({ where: { id: dto.schemeId, isDeleted: false } });
    if (!scheme) throw Errors.NOT_FOUND('方案不存在');
    if (scheme.status === 'DISABLED') throw new BusinessError(40904, '方案已停用，不能发起任务', 409);

    // FR-M05-009：周期关联的任务必须已归档（未归档 → 40003）
    if (dto.linkedTaskIds?.length) {
      for (const lid of dto.linkedTaskIds) {
        const lt: any = await this.prisma.assessmentTask.findFirst({ where: { id: Number(lid) } });
        if (!lt) throw new BusinessError(40003, `关联任务 #${lid} 不存在`, 400);
        if (lt.status !== 'FINISHED') throw new BusinessError(40003, `关联任务「${lt.name}」尚未归档，不能关联`, 400);
      }
    }

    // ===== 草稿模式：只建任务记录，发布时才生成考核单 =====
    if (dto.asDraft) {
      const draft = await this.prisma.assessmentTask.create({
        data: {
          tenantId: tid, schemeId: scheme.id, schemeVersion: scheme.version, name: dto.name, period: dto.period,
          startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), status: 'DRAFT',
          scopeFilter: dto.scopeFilter ?? undefined, linkedTaskIds: dto.linkedTaskIds ?? undefined,
        },
      });
      return { id: Number(draft.id), recordCount: 0, status: 'DRAFT' };
    }

    // 兼容旧行为（直接创建=立即发布）：先以 DRAFT 落库再走统一发布逻辑
    const t0 = await this.prisma.assessmentTask.create({
      data: {
        tenantId: tid, schemeId: scheme.id, schemeVersion: scheme.version, name: dto.name, period: dto.period,
        startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), status: 'DRAFT',
        scopeFilter: dto.scopeFilter ?? undefined, linkedTaskIds: dto.linkedTaskIds ?? undefined,
      },
    });
    return this.start(Number(t0.id));
  }

  // 发布任务（草稿 → RUNNING）：按方案适用范围+任务级选择拍快照，生成考核单/待办/填报单
  async start(taskId: number) {
    const tid = mustCtx().tenantId;
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: taskId, isDeleted: false } });
    if (!task) throw Errors.NOT_FOUND('任务不存在');
    if (task.status !== 'DRAFT') throw new BusinessError(40920, '仅草稿任务可发布', 409);
    const scheme: any = await this.prisma.scheme.findFirst({ where: { id: task.schemeId, isDeleted: false } });
    if (!scheme) throw Errors.NOT_FOUND('方案不存在');
    const dto = { name: task.name };

    // FR-M01-003：按适用范围拍组织快照（任务期内人员调动不影响已生成名单）
    const emps = await this.prisma.employee.findMany({
      where: { isDeleted: false, status: { in: ['ACTIVE', 'PROBATION'] } },
      select: { id: true, empNo: true, name: true, departmentId: true, managerEmpId: true, userId: true, jobLevel: true, hireDate: true },
    });
    const scope: any = scheme.scopeFilter;
    const tscope: any = task.scopeFilter;
    const filtered = emps.filter((e) => {
      if (scope?.deptIds?.length && !scope.deptIds.map(Number).includes(Number(e.departmentId))) return false;
      if (scope?.jobLevels?.length && !scope.jobLevels.includes(e.jobLevel)) return false;
      // 任务级选择：与方案范围取交集（deptIds/empIds 任一命中即可）
      if (tscope && (tscope.deptIds?.length || tscope.empIds?.length)) {
        const inDept = tscope.deptIds?.length ? tscope.deptIds.map(Number).includes(Number(e.departmentId)) : false;
        const inEmp = tscope.empIds?.length ? tscope.empIds.map(Number).includes(Number(e.id)) : false;
        if (!inDept && !inEmp) return false;
      }
      return true;
    });
    if (filtered.length === 0) throw new BusinessError(40015, '适用范围内没有在职员工，无法发起任务');

    const [nodes, indicators, reviewers] = await Promise.all([
      this.prisma.schemeNode.findMany({ where: { schemeId: scheme.id }, orderBy: { seq: 'asc' } }),
      this.prisma.schemeIndicator.findMany({ where: { schemeId: scheme.id } }),
      this.prisma.schemeReviewer.findMany({ where: { schemeId: scheme.id } }),
    ]);
    // 指标详情（sourceType/scoreRule/口径）——填报拆单与计分用
    const indDetails = await this.prisma.indicator.findMany({
      where: { id: { in: indicators.map((i) => i.indicatorId) } },
    });
    const indPairs = indicators.map((si) => ({ schemeIndicator: si, detail: indDetails.find((d) => d.id === si.indicatorId) }));

    const t = task;
    await this.prisma.$transaction(async (tx) => {
      await tx.assessmentTask.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
          orgSnapshot: { employees: filtered.map((e) => ({ empId: Number(e.id), empNo: e.empNo, name: e.name, deptId: Number(e.departmentId), managerEmpId: e.managerEmpId ? Number(e.managerEmpId) : null })) },
        },
      });
      const startStatus = initialStatus(nodes.map((n) => ({ nodeType: n.nodeType, enabled: n.enabled })));
      const createdRecords: { id: bigint; empId: bigint; hireDate: Date }[] = [];
      for (const e of filtered) {
        const rec = await tx.assessmentRecord.create({
          data: {
            tenantId: tid, taskId: t.id, empId: e.id, deptSnapshotId: e.departmentId,
            managerEmpId: e.managerEmpId ?? null, status: startStatus as any,
          },
        });
        for (const i of indicators) {
          await tx.recordIndicator.create({
            data: { tenantId: tid, recordId: rec.id, indicatorId: i.indicatorId, targetValue: i.defaultTarget ?? null },
          });
        }
        // 评价关系实例化：自评 + 直接上级（后续 Sprint 处理互评/下属评/上上级）
        for (const r of reviewers) {
          let reviewerEmpId: bigint | null = null;
          if (r.reviewerType === 'self') reviewerEmpId = e.id;
          else if (r.reviewerType === 'manager') reviewerEmpId = e.managerEmpId;
          if (reviewerEmpId) {
            await tx.recordReviewer.create({
              data: { tenantId: tid, recordId: rec.id, reviewerEmpId, reviewerType: r.reviewerType, status: '待评' },
            });
          }
        }
        await tx.recordStatusLog.create({ data: { tenantId: tid, recordId: rec.id, fromStatus: '', toStatus: startStatus, operatorEmpId: null, note: '任务发起' } });
        createdRecords.push({ id: rec.id, empId: e.id, hireDate: e.hireDate });
        if (e.userId) {
          await tx.todo.create({
            data: { tenantId: tid, userId: e.userId, bizType: 'assessment', bizId: String(rec.id), title: `${dto.name}：处理「${startStatus}」节点`, actionUrl: `/records/${rec.id}` },
          });
        }
      }
      // WP-14：data_fill 节点启用时按出数部门拆分填报工作单（固化口径快照）
      await this.dataFill.spawnOrders(tx, {
        task: { id: t.id, startDate: t.startDate, endDate: t.endDate },
        nodes, records: createdRecords, indicators: indPairs,
      });
      // FR-M03-002：方案首次被任务引用即锁定
      if (scheme.status === 'DRAFT') await tx.scheme.update({ where: { id: scheme.id }, data: { status: 'LOCKED' } });
    });
    return { id: Number(t.id), recordCount: filtered.length, status: 'RUNNING' };
  }

  // 修改草稿任务（名称/周期/日期/范围）
  async update(taskId: number, dto: any) {
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: taskId, isDeleted: false } });
    if (!task) throw Errors.NOT_FOUND('任务不存在');
    if (task.status !== 'DRAFT') throw new BusinessError(40920, '仅草稿任务可修改（已发布的任务不能改）', 409);
    const updated = await this.prisma.assessmentTask.update({
      where: { id: taskId },
      data: {
        name: dto.name ?? task.name, period: dto.period ?? task.period,
        startDate: dto.startDate ? new Date(dto.startDate) : task.startDate,
        endDate: dto.endDate ? new Date(dto.endDate) : task.endDate,
        schemeId: dto.schemeId ? Number(dto.schemeId) : task.schemeId,
        scopeFilter: dto.scopeFilter ?? task.scopeFilter,
      },
    });
    return { id: Number(updated.id) };
  }

  // 删除草稿任务（未发布=无考核单数据，物理删除安全）
  async remove(taskId: number) {
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: taskId, isDeleted: false } });
    if (!task) throw Errors.NOT_FOUND('任务不存在');
    if (task.status !== 'DRAFT') throw new BusinessError(40920, '仅草稿任务可删除（已发布的任务请用「终止」）', 409);
    await this.prisma.assessmentTask.delete({ where: { id: taskId } });
    return { id: taskId };
  }

  async list() {
    const list = await this.prisma.assessmentTask.findMany({ where: { isDeleted: false }, orderBy: { id: 'desc' } });
    const withProgress = await Promise.all(list.map(async (t) => {
      const [total, archived] = await Promise.all([
        this.prisma.assessmentRecord.count({ where: { taskId: t.id } }),
        this.prisma.assessmentRecord.count({ where: { taskId: t.id, status: 'archived' } }),
      ]);
      return { ...t, id: Number(t.id), schemeId: Number(t.schemeId), total, archived, progress: total ? Math.round((archived / total) * 100) : 0 };
    }));
    return withProgress;
  }

  // 任务详情：各节点漏斗（HR 视角）
  async detail(id: number) {
    const t = await this.prisma.assessmentTask.findFirst({ where: { id, isDeleted: false } });
    if (!t) throw Errors.NOT_FOUND('任务不存在');
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId: id } });
    const byStatus: Record<string, number> = {};
    for (const r of records) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    return { ...t, id: Number(t.id), schemeId: Number(t.schemeId), total: records.length, byStatus };
  }

  // 任务的人员明细（W-09）
  async listRecords(taskId: number) {
    const list = await this.prisma.assessmentRecord.findMany({ where: { taskId }, orderBy: { id: 'asc' } });
    return Promise.all(list.map(async (r) => {
      const emp: any = await this.prisma.employee.findFirst({ where: { id: r.empId } });
      return { ...r, id: Number(r.id), empId: Number(r.empId), employeeName: emp?.name ?? `#${r.empId}`,
        finalScore: r.finalScore != null ? Number(r.finalScore) : null };
    }));
  }

  // 状态机推进（PRD 7.2 硬约束）：非法跳转一律 4xx（UAT 4）
  async advance(recordId: number, toStatus: string, note?: string) {
    const tid = mustCtx().tenantId;
    const rec = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const task = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const nodes = await this.prisma.schemeNode.findMany({ where: { schemeId: task.schemeId } });
    if (!canTransit(nodes.map((n) => ({ nodeType: n.nodeType, enabled: n.enabled })), rec.status, toStatus)) {
      throw new BusinessError(40905, `非法状态跳转：${rec.status} → ${toStatus}`, 409);
    }
    const c = mustCtx();
    const updated = await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { status: toStatus as any } });
    await this.prisma.recordStatusLog.create({ data: { tenantId: tid, recordId, fromStatus: rec.status, toStatus: toStatus, operatorEmpId: c.empId ?? null, note: note || null } });
    // 归档后若全员归档 → 任务 FINISHED（PRD 7.1）
    if (toStatus === 'archived') {
      const [total, archived] = await Promise.all([
        this.prisma.assessmentRecord.count({ where: { taskId: rec.taskId } }),
        this.prisma.assessmentRecord.count({ where: { taskId: rec.taskId, status: 'archived' } }),
      ]);
      if (total === archived) await this.prisma.assessmentTask.update({ where: { id: rec.taskId }, data: { status: 'FINISHED' } });
    }
    return { id: Number(updated.id), status: updated.status };
  }

  // 发布结果（FR-M06-004）：存在未结异议一律拦截；校准中的考核单进入结果确认
  async publish(id: number) {
    await this.dataFill.assertNoPendingObjections(id);
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId: id } });
    const notReady = records.filter((r) => r.status !== 'calibrating' && r.status !== 'result_confirm' && r.status !== 'appealing');
    if (notReady.length > 0) {
      throw new BusinessError(40908, `尚有 ${notReady.length} 张考核单未进入校准节点，不能发布`, 409);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const r of records) {
        if (r.status === 'calibrating') {
          await tx.assessmentRecord.update({ where: { id: r.id }, data: { status: 'result_confirm', publishTime: new Date() } });
          await tx.recordStatusLog.create({ data: { tenantId: mustCtx().tenantId, recordId: r.id, fromStatus: 'calibrating', toStatus: 'result_confirm', note: 'HR 发布结果' } });
          const emp: any = await tx.employee.findFirst({ where: { id: r.empId } });
          if (emp?.userId) {
            await tx.message.create({ data: { tenantId: mustCtx().tenantId, userId: emp.userId, bizType: 'result', title: '绩效结果已出', content: `「${(await this.prisma.assessmentTask.findFirst({ where: { id: r.taskId } }))?.name ?? ''}」结果已发布，请查看并确认` } });
          }
        }
      }
    });
    return { published: records.length };
  }

  async getRecord(id: number) {
    const rec = await this.prisma.assessmentRecord.findFirst({ where: { id } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const [indicators, reviewers, logs] = await Promise.all([
      this.prisma.recordIndicator.findMany({ where: { recordId: id } }),
      this.prisma.recordReviewer.findMany({ where: { recordId: id } }),
      this.prisma.recordStatusLog.findMany({ where: { recordId: id }, orderBy: { id: 'asc' } }),
    ]);
    // AC5 防倒推：填报完成前，被考核人本人任何接口拿不到客观指标完成值/得分
    const c = ctx();
    let masked = indicators;
    if (c?.empId && Number(rec.empId) === c.empId) {
      const objective = indicators.filter((i) => i.scoreSource === 'data_fill' || true);
      const recIndicators = await this.prisma.recordIndicator.findMany({ where: { recordId: id } });
      const hasUnfilled = await this.hasUnfilledObjective(id, recIndicators);
      if (hasUnfilled) {
        const unfilledIds = new Set(
          (await this.unfilledObjectiveItems(id)).map((x) => Number(x.indicatorId)),
        );
        masked = indicators.map((i) =>
          unfilledIds.has(Number(i.indicatorId))
            ? { ...i, actualValue: null, weightedScore: null, scoreMasked: true }
            : i,
        );
        void objective;
      }
    }
    return { ...rec, id: Number(rec.id), taskId: Number(rec.taskId), indicators: masked, reviewers, logs };
  }

  // 是否存在尚未填报计分的客观指标行（防倒推判定）
  private async hasUnfilledObjective(recordId: number, ris: any[]): Promise<boolean> {
    return (await this.unfilledObjectiveItems(recordId, ris)).length > 0;
  }
  private async unfilledObjectiveItems(recordId: number, ris?: any[]): Promise<any[]> {
    const recIndicators = ris || await this.prisma.recordIndicator.findMany({ where: { recordId } });
    const indIds = recIndicators.map((r) => r.indicatorId);
    const inds = await this.prisma.indicator.findMany({ where: { id: { in: indIds } }, select: { id: true, sourceType: true } });
    const objectiveIds = new Set(inds.filter((i) => i.sourceType === 'dept_report' || i.sourceType === 'auto_system').map((i) => Number(i.id)));
    return recIndicators.filter((r) => objectiveIds.has(Number(r.indicatorId)) && r.scoreSource !== 'data_fill');
  }
}
