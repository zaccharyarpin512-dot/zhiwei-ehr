// M03 绩效方案服务（FR-M03-001/002/003）：5 步向导数据面 + 权重/节点硬校验 + 版本锁定 + 人群预览
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { mustCtx } from '../../tenant-context';
import { BusinessError, Errors } from '../../common/errors';
import { NODE_ORDER } from '../../lib/state-machine';

export const ERR = {
  SCHEME_LOCKED: () => new BusinessError(40903, '方案已被考核任务引用并锁定，修改需另存新版本', 409),
  NODE_REQUIRES_OBJECTIVE: () => new BusinessError(40013, '数据填报节点仅当方案含客观指标（部门出数/系统取数）时可用'),
  BAD_NODES: () => new BusinessError(40014, '流程节点序列不合法（须按 PRD 7.2 顺序且不重复）'),
};

@Injectable()
export class SchemeService {
  constructor(private prisma: PrismaService) {}

  private validate(nodes: any[], hasObjective: boolean) {
    // 节点序列校验：去重后必须保持全序
    const types = nodes.map((n) => n.nodeType);
    if (new Set(types).size !== types.length) throw ERR.BAD_NODES();
    const idx = types.map((t) => NODE_ORDER.indexOf(t));
    if (idx.some((i) => i < 0)) throw ERR.BAD_NODES();
    for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) throw ERR.BAD_NODES();
    // data_fill 节点仅当方案含客观指标（依据指标库 sourceType 判定）
    if (types.includes('data_fill') && !hasObjective) throw ERR.NODE_REQUIRES_OBJECTIVE();
  }

  async create(dto: any) {
    const weightSum = (dto.indicators || []).reduce((a: number, b: any) => a + Number(b.weight), 0);
    if (Math.abs(weightSum - 100) > 0.001) throw Errors.WEIGHT_NOT_100(); // AC2（40001）
    // 客观指标判定：查指标库 sourceType（dept_report / auto_system 为客观）
    const indRows = await this.prisma.indicator.findMany({
      where: { id: { in: (dto.indicators || []).map((i: any) => Number(i.indicatorId)) } },
      select: { sourceType: true },
    });
    const hasObjective = indRows.some((r) => r.sourceType === 'dept_report' || r.sourceType === 'auto_system');
    this.validate(dto.nodes || [], hasObjective);
    const tid = mustCtx().tenantId;

    const scheme = await this.prisma.$transaction(async (tx) => {
      const sc = await tx.scheme.create({
        data: {
          tenantId: tid, name: dto.name, mode: dto.mode, periodType: dto.periodType,
          scopeFilter: dto.scopeFilter ?? undefined, linkageConfig: dto.linkageConfig ?? undefined,
          taskCreditConfig: dto.taskCreditConfig ?? undefined,
        },
      });
      for (const n of dto.nodes || []) {
        await tx.schemeNode.create({ data: { tenantId: tid, schemeId: sc.id, nodeType: n.nodeType, seq: n.seq, timeConfig: n.timeConfig ?? undefined, enabled: n.enabled ?? true } });
      }
      for (const i of dto.indicators || []) {
        await tx.schemeIndicator.create({ data: { tenantId: tid, schemeId: sc.id, indicatorId: i.indicatorId, weight: i.weight, defaultTarget: i.defaultTarget ?? null } });
      }
      for (const q of dto.questions || []) {
        await tx.schemeQuestion.create({ data: { tenantId: tid, schemeId: sc.id, title: q.title, qType: q.qType, options: q.options ?? undefined, required: q.required ?? true } });
      }
      for (const g of dto.gradeRules || []) {
        await tx.schemeGradeRule.create({ data: { tenantId: tid, schemeId: sc.id, grade: g.grade, minScore: g.minScore, maxScore: g.maxScore, ratioLimit: g.ratioLimit ?? null, sortNo: g.sortNo ?? 0 } });
      }
      for (const r of dto.reviewers || []) {
        await tx.schemeReviewer.create({ data: { tenantId: tid, schemeId: sc.id, reviewerType: r.reviewerType, weight: r.weight, config: r.config ?? undefined } });
      }
      return sc;
    });
    return this.get(Number(scheme.id));
  }

  async get(id: number) {
    const sc = await this.prisma.scheme.findFirst({ where: { id, isDeleted: false } });
    if (!sc) throw Errors.NOT_FOUND('方案不存在');
    const [nodes, indicators, questions, gradeRules, reviewers] = await Promise.all([
      this.prisma.schemeNode.findMany({ where: { schemeId: id }, orderBy: { seq: 'asc' } }),
      this.prisma.schemeIndicator.findMany({ where: { schemeId: id } }),
      this.prisma.schemeQuestion.findMany({ where: { schemeId: id } }),
      this.prisma.schemeGradeRule.findMany({ where: { schemeId: id }, orderBy: { sortNo: 'asc' } }),
      this.prisma.schemeReviewer.findMany({ where: { schemeId: id } }),
    ]);
    return { ...sc, nodes, indicators, questions, gradeRules, reviewers };
  }

  async list() {
    const list = await this.prisma.scheme.findMany({ where: { isDeleted: false }, orderBy: { id: 'desc' } });
    return list.map((s) => ({ ...s, id: Number(s.id) }));
  }

  async update(id: number, dto: any) {
    const sc = await this.prisma.scheme.findFirst({ where: { id, isDeleted: false } });
    if (!sc) throw Errors.NOT_FOUND('方案不存在');
    if (sc.status !== 'DRAFT') throw ERR.SCHEME_LOCKED(); // FR-M03-002
    const updated = await this.prisma.scheme.update({ where: { id }, data: { name: dto.name ?? sc.name } });
    return { id: Number(updated.id) };
  }

  async copy(id: number) {
    const src = await this.get(id);
    const copy = await this.create({
      name: `${src.name}（副本）`, mode: src.mode, periodType: src.periodType,
      scopeFilter: src.scopeFilter, linkageConfig: src.linkageConfig, taskCreditConfig: src.taskCreditConfig,
      nodes: src.nodes.map((n: any) => ({ nodeType: n.nodeType, seq: n.seq, timeConfig: n.timeConfig, enabled: n.enabled })),
      indicators: src.indicators.map((i: any) => ({ indicatorId: Number(i.indicatorId), weight: i.weight, defaultTarget: i.defaultTarget })),
      questions: src.questions.map((q: any) => ({ title: q.title, qType: q.qType, options: q.options, required: q.required })),
      gradeRules: src.gradeRules.map((g: any) => ({ grade: g.grade, minScore: g.minScore, maxScore: g.maxScore, ratioLimit: g.ratioLimit, sortNo: g.sortNo })),
      reviewers: src.reviewers.map((r: any) => ({ reviewerType: r.reviewerType, weight: r.weight, config: r.config })),
    });
    return copy;
  }

  // FR-M03-003：人群预览（按部门/职级筛选命中员工）
  async previewAudience(scopeFilter: any) {
    const where: any = { isDeleted: false, status: { in: ['ACTIVE', 'PROBATION'] } };
    if (scopeFilter?.deptIds?.length) where.departmentId = { in: scopeFilter.deptIds.map(Number) };
    if (scopeFilter?.jobLevels?.length) where.jobLevel = { in: scopeFilter.jobLevels };
    const emps = await this.prisma.employee.findMany({ where, select: { id: true, empNo: true, name: true, departmentId: true, jobLevel: true } });
    return { count: emps.length, employees: emps.map((e) => ({ ...e, id: Number(e.id) })) };
  }

  // 任务引用时锁定方案（FR-M03-002）
  async lock(id: number) {
    await this.prisma.scheme.update({ where: { id }, data: { status: 'LOCKED' } });
  }
}
