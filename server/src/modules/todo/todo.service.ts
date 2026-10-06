// WP-17 待办/消息/催办服务（FR-M10-001/002/003）
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

// 催办频控：同一人同一事项 24h 内最多 3 次（FR-M10-003，Redis 未部署先用进程内计数，接口语义一致）
const remindLog = new Map<string, number[]>();
const WINDOW_MS = 24 * 3600 * 1000;
const MAX_REMINDS = 3;

@Injectable()
export class TodoService {
  constructor(private prisma: PrismaService) {}

  async listTodos(status?: string) {
    const c = mustCtx();
    const where: any = { userId: c.userId };
    if (status) where.status = status;
    const list = await this.prisma.todo.findMany({ where, orderBy: { id: 'desc' } });
    return list.map((t) => ({ ...t, id: Number(t.id) }));
  }

  async done(id: number) {
    const c = mustCtx();
    await this.prisma.todo.updateMany({ where: { id, userId: c.userId }, data: { status: '已完成' } });
    return { id, status: '已完成' };
  }

  async listMessages(unread?: string) {
    const c = mustCtx();
    const where: any = { userId: c.userId };
    if (unread === '1') where.readFlag = false;
    const list = await this.prisma.message.findMany({ where, orderBy: { id: 'desc' } });
    return list.map((m) => ({ ...m, id: Number(m.id) }));
  }

  async readMessage(id: number) {
    const c = mustCtx();
    await this.prisma.message.updateMany({ where: { id, userId: c.userId }, data: { readFlag: true } });
    return { id, readFlag: true };
  }

  // 批量催办：给指定考核单的员工发消息，频控 24h/3 次（第 4 次拒绝）
  async remind(taskId: number, recordIds: number[]) {
    const tid = mustCtx().tenantId;
    const task = await this.prisma.assessmentTask.findFirst({ where: { id: taskId } });
    if (!task) throw Errors.NOT_FOUND('任务不存在');
    const records = await this.prisma.assessmentRecord.findMany({ where: { id: { in: recordIds }, taskId } });
    if (records.length === 0) throw Errors.NOT_FOUND('考核单不存在');
    let reminded = 0, blocked = 0;
    for (const r of records) {
      const emp: any = await this.prisma.employee.findFirst({ where: { id: r.empId } });
      if (!emp?.userId) continue;
      const key = `${emp.userId}:${r.id}`;
      const now = Date.now();
      const hist = (remindLog.get(key) || []).filter((t) => now - t < WINDOW_MS);
      if (hist.length >= MAX_REMINDS) { blocked++; continue; }
      hist.push(now);
      remindLog.set(key, hist);
      await this.prisma.message.create({ data: {
        tenantId: tid, userId: emp.userId, bizType: 'remind',
        title: `【催办】${task.name} 请及时处理当前考核节点`,
        content: `您在「${task.name}」中的考核单（#${r.id}）仍停留在「${r.status}」节点，请尽快处理。`,
      } });
      reminded++;
    }
    return { reminded, blocked };
  }
}

export function clearRemindLog() { remindLog.clear(); }
