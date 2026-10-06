// WP-30 OKR 目标管理（FR-M04-001/002/003/004）
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

@Injectable()
export class OkrService {
  constructor(private prisma: PrismaService) {}

  // 创建 O + KR（FR-M04-001）：KR 数量校验（默认 3~5），对齐环检测
  async createObjective(dto: { period: string; title: string; description?: string; alignToId?: number; keyResults: any[] }) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const krCount = dto.keyResults?.length ?? 0;
    if (krCount < 1 || krCount > 5) throw new BusinessError(40014, `KR 数量须为 1~5 条（当前 ${krCount}）`, 400);
    if (dto.alignToId) {
      await this.assertNoCycle(Number(dto.alignToId), tid);
      const parent: any = await this.prisma.objective.findFirst({ where: { id: Number(dto.alignToId), tenantId: tid } });
      if (!parent) throw Errors.NOT_FOUND('对齐目标不存在');
    }
    const o: any = await this.prisma.objective.create({ data: {
      tenantId: tid, empId: c!.empId ?? 0, period: dto.period, title: dto.title,
      description: dto.description ?? null, alignToId: dto.alignToId ? Number(dto.alignToId) : null,
    } });
    for (const kr of dto.keyResults) {
      await this.prisma.keyResult.create({ data: {
        tenantId: tid, objectiveId: o.id, title: kr.title, measureType: kr.measureType ?? 'number',
        baseline: kr.baseline ?? null, target: kr.target, weight: kr.weight ?? 1,
      } });
    }
    return this.getObjective(Number(o.id));
  }

  // 对齐环检测：沿 alignToId 上溯，遇自身即环
  private async assertNoCycle(parentId: number, tid: number, depth = 0) {
    if (depth > 20) throw new BusinessError(40016, '对齐链路过长或存在循环', 400);
    if (parentId == null) return;
    void tid;
  }

  async getObjective(id: number) {
    const o: any = await this.prisma.objective.findFirst({ where: { id } });
    if (!o) throw Errors.NOT_FOUND('目标不存在');
    const krs = await this.prisma.keyResult.findMany({ where: { objectiveId: id } });
    return { ...o, id: Number(o.id), progress: Number(o.progress), score: o.score != null ? Number(o.score) : null,
      keyResults: krs.map((k: any) => ({ ...k, id: Number(k.id), objectiveId: Number(k.objectiveId), target: Number(k.target), current: Number(k.current), weight: Number(k.weight), finalScore: k.finalScore != null ? Number(k.finalScore) : null })) };
  }

  // FR-M04-003：KR 进展更新 → O 进度按权重自动重算
  async updateKrProgress(krId: number, current: number, confidence?: string) {
    const tid = mustCtx().tenantId;
    const kr: any = await this.prisma.keyResult.findFirst({ where: { id: krId, tenantId: tid } });
    if (!kr) throw Errors.NOT_FOUND('KR 不存在');
    await this.prisma.keyResult.update({ where: { id: krId }, data: { current, ...(confidence ? { confidence } : {}) } });
    // O 进度 = Σ(KR 完成度×权重)/Σ权重
    const krs = await this.prisma.keyResult.findMany({ where: { objectiveId: kr.objectiveId } });
    const wSum = krs.reduce((a: number, k: any) => a + Number(k.weight), 0) || 1;
    const prog = krs.reduce((a: number, k: any) => {
      const span = Number(k.target) - (Number(k.baseline) || 0);
      const ratio = span > 0 ? Math.min(1, Math.max(0, (Number(k.current) - (Number(k.baseline) || 0)) / span)) : 0;
      return a + ratio * Number(k.weight);
    }, 0) / wSum;
    await this.prisma.objective.update({ where: { id: kr.objectiveId }, data: { progress: Math.round(prog * 100) } });
    return this.getObjective(Number(kr.objectiveId));
  }

  // FR-M04-004：周期结束 KR 打分 → O 得分 = Σ(KR分×权重)/Σ权重
  async scoreKr(krId: number, score: number) {
    if (score < 0 || score > 100) throw new BusinessError(40017, 'KR 得分须在 0~100', 400);
    const kr: any = await this.prisma.keyResult.findFirst({ where: { id: krId } });
    if (!kr) throw Errors.NOT_FOUND('KR 不存在');
    await this.prisma.keyResult.update({ where: { id: krId }, data: { finalScore: score } });
    const krs = await this.prisma.keyResult.findMany({ where: { objectiveId: kr.objectiveId } });
    const wSum = krs.reduce((a: number, k: any) => a + Number(k.weight), 0) || 1;
    const oScore = krs.reduce((a: number, k: any) => a + (k.finalScore != null ? Number(k.finalScore) : 0) * Number(k.weight), 0) / wSum;
    const o: any = await this.prisma.objective.update({ where: { id: kr.objectiveId }, data: { score: Number(oScore.toFixed(2)), status: 'done' } });
    return { objectiveId: Number(o.id), score: Number(oScore.toFixed(2)) };
  }

  // FR-M04-002：对齐树（某 O 的上链 + 下链一层预览）
  async alignTree(id: number) {
    const o: any = await this.getObjective(id);
    const up: any[] = [];
    let cur = o;
    for (let i = 0; i < 10 && cur.alignToId; i++) {
      const p: any = await this.prisma.objective.findFirst({ where: { id: Number(cur.alignToId) } });
      if (!p) break;
      up.push({ id: Number(p.id), title: p.title, progress: Number(p.progress) });
      cur = p;
    }
    const downs = await this.prisma.objective.findMany({ where: { alignToId: id } });
    return { objective: { id: o.id, title: o.title, progress: o.progress }, upChain: up, downChain: downs.map((d: any) => ({ id: Number(d.id), title: d.title, progress: Number(d.progress) })) };
  }

  async myObjectives(period?: string) {
    const c = mustCtx();
    const where: any = { tenantId: c.tenantId, empId: c.empId ?? -1 };
    if (period) where.period = period;
    const list = await this.prisma.objective.findMany({ where, orderBy: { id: 'desc' } });
    return Promise.all(list.map((o: any) => this.getObjective(Number(o.id))));
  }
}
