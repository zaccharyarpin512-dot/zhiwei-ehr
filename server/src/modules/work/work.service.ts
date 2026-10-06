// WP-31/32 过程任务 + 悬赏集市（FR-M12-001/002）
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

@Injectable()
export class WorkService {
  constructor(private prisma: PrismaService) {}

  // 幂等积分入账：unique(bizType,bizId) 防重复；余额封底 0
  private async credit(empId: number, points: number, bizType: string, bizId: string) {
    const tid = mustCtx().tenantId;
    const exist = await this.prisma.rewardFlow.findFirst({ where: { tenantId: tid, bizType, bizId } });
    if (exist) return { duplicated: true, balance: Number(exist.balanceAfter) }; // 幂等（UAT 11-②）
    const acct: any = await this.prisma.rewardAccount.upsert({
      where: { tenantId_empId: { tenantId: tid, empId } },
      create: { tenantId: tid, empId, balance: 0 },
      update: {},
    });
    const after = Math.max(0, Number(acct.balance) + points); // 弃单扣分封底 0（UAT 11-③）
    await this.prisma.$transaction([
      this.prisma.rewardAccount.update({ where: { id: acct.id }, data: { balance: after } }),
      this.prisma.rewardFlow.create({ data: { tenantId: tid, empId, bizType, bizId, points, balanceAfter: after } }),
    ]);
    return { duplicated: false, balance: after };
  }

  // 任务下达（FR-M12-001）：悬赏任务进集市（assigneeEmpId=null, market_open）
  async create(dto: { title: string; description?: string; assigneeEmpId?: number; priority?: string; dueDate?: string; rewardPoints?: number; scope?: string; krId?: number }) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    if (dto.assigneeEmpId && dto.rewardPoints) throw new BusinessError(40018, '指派任务与悬赏积分互斥', 400);
    const isMarket = !dto.assigneeEmpId && (dto.rewardPoints ?? 0) > 0;
    const t: any = await this.prisma.workTask.create({ data: {
      tenantId: tid, title: dto.title, description: dto.description ?? null,
      assigneeEmpId: dto.assigneeEmpId ?? null, publisherEmpId: c!.empId ?? 0,
      priority: dto.priority ?? 'medium', dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      rewardPoints: dto.rewardPoints ?? 0, scope: dto.scope ?? 'dept', krId: dto.krId ?? null,
      status: isMarket ? 'market_open' : 'assigned', source: isMarket ? 'market' : (dto.assigneeEmpId ? 'assign' : 'self'),
    } });
    if (dto.assigneeEmpId) {
      const a: any = await this.prisma.employee.findFirst({ where: { id: dto.assigneeEmpId } });
      if (a?.userId) await this.prisma.todo.create({ data: { tenantId: tid, userId: a.userId, bizType: 'work_task', bizId: String(t.id), title: `新任务：${dto.title}`, actionUrl: `/work-tasks/${t.id}` } });
    }
    return { id: Number(t.id), status: t.status };
  }

  // 我的任务列表（我执行的+我发布的+集市待认领）
  async list(view: 'mine' | 'published' | 'market' | 'all') {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const isAdmin = (c!.roles || []).some((r: string) => r === 'hr_admin' || r === 'super_admin');
    const where: any = { tenantId: tid };
    if (view === 'all') {
      // HR/管理员看全部；普通员工只能看自己相关的
      if (!isAdmin) where.OR = [{ assigneeEmpId: c!.empId ?? -1 }, { publisherEmpId: c!.empId ?? -1 }];
    } else if (view === 'mine') where.assigneeEmpId = c!.empId ?? -1;
    else if (view === 'published') {
      if (isAdmin) { /* 管理员：全部已发布 */ } else where.publisherEmpId = c!.empId ?? -1;
    } else where.status = 'market_open';
    const list = await this.prisma.workTask.findMany({ where, orderBy: { id: 'desc' } });
    return list.map((t: any) => ({ ...t, id: Number(t.id), rewardPoints: Number(t.rewardPoints) }));
  }

  // 先到先得认领（FR-M12-002）：条件更新原子占位，第二人 40005（UAT 11-①）
  async claim(taskId: number) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const res = await this.prisma.workTask.updateMany({
      where: { id: taskId, tenantId: tid, status: 'market_open', assigneeEmpId: null },
      data: { assigneeEmpId: c!.empId ?? -1, status: 'in_progress', acceptedAt: new Date() },
    });
    if (res.count === 0) throw new BusinessError(40005, '手慢了，该悬赏已被认领', 409);
    await this.prisma.marketClaimLog.create({ data: { tenantId: tid, taskId, claimerEmpId: c!.empId ?? -1 } }).catch(() => {});
    return { taskId, status: 'in_progress' };
  }

  // 状态流转：in_progress→submitted→accepted/rejected；accepted 发积分
  async transition(taskId: number, to: string, note?: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const t: any = await this.prisma.workTask.findFirst({ where: { id: taskId, tenantId: tid } });
    if (!t) throw Errors.NOT_FOUND('任务不存在');
    const me = c!.empId ?? -1;
    const allowed: Record<string, string[]> = {
      assigned: ['in_progress'],
      in_progress: ['submitted'],
      submitted: ['accepted', 'rejected'],
      rejected: ['in_progress'],
    };
    if (!allowed[t.status]?.includes(to)) throw new BusinessError(40916, `非法任务流转：${t.status} → ${to}`, 409);
    if (to === 'submitted' && Number(t.assigneeEmpId) !== me) throw Errors.FORBIDDEN();
    if ((to === 'accepted' || to === 'rejected') && Number(t.publisherEmpId) !== me && !c!.roles.includes('hr_admin')) throw Errors.FORBIDDEN();
    await this.prisma.workTask.update({ where: { id: taskId }, data: { status: to as any } });
    let reward: any = null;
    if (to === 'accepted' && Number(t.rewardPoints) > 0) {
      reward = await this.credit(Number(t.assigneeEmpId), Number(t.rewardPoints), 'market_reward', `task:${taskId}`);
    }
    void note;
    return { taskId, status: to, reward };
  }

  // 弃单：认领后放弃 → 发布人审批通过后记弃单并扣分
  async abandon(taskId: number) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const t: any = await this.prisma.workTask.findFirst({ where: { id: taskId, tenantId: tid } });
    if (!t || Number(t.assigneeEmpId) !== (c!.empId ?? -1)) throw Errors.FORBIDDEN();
    if (!['in_progress', 'rejected'].includes(t.status)) throw new BusinessError(40917, '当前状态不可弃单', 409);
    await this.prisma.workTask.update({ where: { id: taskId }, data: { assigneeEmpId: null, status: 'market_open', acceptedAt: null } });
    const penalty = await this.credit(c!.empId ?? -1, -Math.min(10, Number(t.rewardPoints)), 'penalty', `abandon:${taskId}:${Date.now()}`);
    const p: any = await this.prisma.employee.findFirst({ where: { id: t.publisherEmpId } });
    if (p?.userId) await this.prisma.todo.create({ data: { tenantId: tid, userId: p.userId, bizType: 'abandon', bizId: String(taskId), title: `弃单审批：${t.title}`, actionUrl: `/work-tasks/${taskId}` } });
    return { taskId, status: 'market_open', penalty };
  }

  // 积分账户与流水
  async account(empId?: number) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const id = empId ?? (c!.empId ?? -1);
    const acct: any = await this.prisma.rewardAccount.findFirst({ where: { tenantId: tid, empId: id } });
    const flows = await this.prisma.rewardFlow.findMany({ where: { tenantId: tid, empId: id }, orderBy: { id: 'desc' }, take: 50 });
    return { empId: id, balance: acct ? Number(acct.balance) : 0, flows: flows.map((f: any) => ({ ...f, id: Number(f.id) })) };
  }

  // WP-34 任务日历：按截止日分组本人相关任务（APP 周视图数据源）
  async calendar(from: Date, to: Date) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const me = c!.empId ?? -1;
    const list = await this.prisma.workTask.findMany({
      where: { tenantId: tid, dueDate: { gte: from, lte: to }, OR: [{ assigneeEmpId: me }, { publisherEmpId: me }] },
      orderBy: { dueDate: 'asc' },
    });
    const byDate: Record<string, any[]> = {};
    for (const t of list) {
      const key = (t.dueDate as Date).toISOString().slice(0, 10);
      (byDate[key] = byDate[key] || []).push({
        id: Number(t.id), title: t.title, priority: t.priority, status: t.status,
        rewardPoints: Number(t.rewardPoints), overdue: new Date(t.dueDate as Date) < new Date() && t.status !== 'accepted',
        mine: Number(t.assigneeEmpId) === me,
      });
    }
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), byDate,
      summary: { total: list.length, overdue: list.filter((t: any) => new Date(t.dueDate as Date) < new Date() && t.status !== 'accepted').length, reward: list.filter((t: any) => Number(t.rewardPoints) > 0).length } };
  }

  // 过程数据按考核周期聚合（FR-M12-004，供 WP-33 考核对接消费）
  async taskStat(empId: number, from: Date, to: Date) {
    const tid = mustCtx().tenantId;
    const tasks = await this.prisma.workTask.findMany({ where: { tenantId: tid, assigneeEmpId: empId, createdAt: { gte: from, lte: to } } });
    const total = tasks.length;
    const accepted = tasks.filter((t: any) => t.status === 'accepted').length;
    const overdue = tasks.filter((t: any) => t.dueDate && new Date(t.dueDate) < new Date()).length; // 含已完成但超期
    const rewards = await this.prisma.rewardFlow.aggregate({ where: { tenantId: tid, empId, bizType: { in: ['market_reward', 'penalty'] }, createdAt: { gte: from, lte: to } }, _sum: { points: true } });
    return { total, accepted, onTimeRate: total ? Number(((accepted / total) * 100).toFixed(1)) : null, overdue, rewardPoints: Number(rewards._sum.points ?? 0) };
  }
}
