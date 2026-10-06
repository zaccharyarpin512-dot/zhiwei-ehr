// WP-22 结果申诉与面谈闭环（FR-M05-006 / FR-M07-001）
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

@Injectable()
export class DisputeService {
  constructor(private prisma: PrismaService) {}

  private async mustRecord(recordId: number) {
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    return rec;
  }

  private async empUserId(empId: number | bigint) {
    const emp: any = await this.prisma.employee.findFirst({ where: { id: empId } });
    return emp?.userId ? Number(emp.userId) : null;
  }

  // 员工发起申诉（FR-M05-006）：仅本人、须已发布（result_confirm）、一单仅一条未结申诉
  async appeal(recordId: number, reason: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const rec = await this.mustRecord(recordId);
    if (!c?.empId || Number(rec.empId) !== c.empId) throw Errors.FORBIDDEN();
    if (rec.status !== 'result_confirm') throw new BusinessError(40910, '仅「结果确认」状态可发起申诉', 409);
    const pending = await this.prisma.appeal.findFirst({ where: { recordId, status: 'PENDING' } });
    if (pending) throw new BusinessError(40911, '该考核单已有一条处理中的申诉', 409);
    const a = await this.prisma.appeal.create({ data: { tenantId: tid, recordId, reason } });
    await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { status: 'appealing' } });
    await this.prisma.recordStatusLog.create({ data: { tenantId: tid, recordId, fromStatus: 'result_confirm', toStatus: 'appealing', operatorEmpId: c.empId, note: `发起申诉：${reason.slice(0, 50)}` } });
    // HR 待办
    const hrUsers = await this.prisma.user.findMany({ where: { tenantId: tid, roles: { hasSome: ['hr_admin'] } } });
    for (const u of hrUsers) {
      await this.prisma.todo.create({ data: { tenantId: tid, userId: u.id, bizType: 'appeal', bizId: String(a.id), title: `处理申诉：考核单 #${recordId}`, actionUrl: `/appeals/${a.id}` } });
    }
    return { id: Number(a.id), status: 'PENDING' };
  }

  // HR 处理申诉：维持（uphold）或调整（adjust，写回新分/新级并审计）
  async handleAppeal(appealId: number, dto: { result: 'uphold' | 'adjust'; note: string; newScore?: number; newGrade?: string }) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const a: any = await this.prisma.appeal.findFirst({ where: { id: appealId } });
    if (!a) throw Errors.NOT_FOUND('申诉不存在');
    if (a.status !== 'PENDING') throw new BusinessError(40912, '该申诉已处理', 409);
    if (!dto.note || dto.note.trim().length < 2) throw new BusinessError(40010, '处理说明必填（≥2 字）', 400);
    if (dto.result === 'adjust' && dto.newScore == null) throw new BusinessError(40011, '调整结果必须给出新分数', 400);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.appeal.update({ where: { id: appealId }, data: {
        status: dto.result === 'adjust' ? 'ADJUSTED' : 'UPHELD',
        resultNote: dto.note, newScore: dto.newScore ?? null, newGrade: dto.newGrade ?? null,
        handlerEmpId: c?.empId ?? null, handledAt: new Date(),
      } });
      if (dto.result === 'adjust') {
        await tx.assessmentRecord.update({ where: { id: a.recordId }, data: { finalScore: dto.newScore, grade: dto.newGrade ?? undefined } });
      }
      // 申诉闭环：回到结果确认（PRD 7.2 分支）
      await tx.assessmentRecord.update({ where: { id: a.recordId }, data: { status: 'result_confirm' } });
      await tx.recordStatusLog.create({ data: { tenantId: tid, recordId: a.recordId, fromStatus: 'appealing', toStatus: 'result_confirm', operatorEmpId: c?.empId ?? null, note: `申诉${dto.result === 'adjust' ? `调整：${dto.newScore} 分${dto.newGrade ? ' / ' + dto.newGrade : ''}` : '维持原结果'}（${dto.note.slice(0, 40)}）` } });
    });
    // 通知员工
    const rec = await this.mustRecord(a.recordId);
    const uid = await this.empUserId(rec.empId);
    if (uid) {
      await this.prisma.message.create({ data: { tenantId: tid, userId: uid, bizType: 'appeal_result', title: '您的申诉已处理', content: dto.note } });
    }
    return { id: appealId, status: dto.result === 'adjust' ? 'ADJUSTED' : 'UPHELD' };
  }

  // 经理提交面谈记录（FR-M07-001）：result_confirm → interviewing
  async interview(recordId: number, summary: string, improvementGoals?: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const rec = await this.mustRecord(recordId);
    if (rec.status !== 'result_confirm') throw new BusinessError(40913, '仅「结果确认」状态可安排面谈', 409);
    const iv = await this.prisma.interviewRecord.create({ data: { tenantId: tid, recordId, managerEmpId: c?.empId ?? rec.managerEmpId ?? 0, summary, improvementGoals: improvementGoals ?? null } });
    await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { status: 'interviewing' } });
    await this.prisma.recordStatusLog.create({ data: { tenantId: tid, recordId, fromStatus: 'result_confirm', toStatus: 'interviewing', operatorEmpId: c?.empId ?? null, note: '提交面谈记录' } });
    const uid = await this.empUserId(rec.empId);
    if (uid) {
      await this.prisma.todo.create({ data: { tenantId: tid, userId: uid, bizType: 'interview', bizId: String(iv.id), title: '确认绩效面谈记录', actionUrl: `/records/${recordId}` } });
    }
    return { id: Number(iv.id) };
  }

  // 员工确认面谈 → 归档（PRD 7.2：面谈为可选终点节点）
  async confirmInterview(recordId: number, comment?: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const rec = await this.mustRecord(recordId);
    if (!c?.empId || Number(rec.empId) !== c.empId) throw Errors.FORBIDDEN();
    if (rec.status !== 'interviewing') throw new BusinessError(40914, '当前不在面谈节点', 409);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.interviewRecord.updateMany({ where: { recordId }, data: { employeeConfirmed: true, employeeComment: comment ?? null, confirmedAt: new Date() } });
      await tx.assessmentRecord.update({ where: { id: recordId }, data: { status: 'archived' } });
      await tx.recordStatusLog.create({ data: { tenantId: tid, recordId, fromStatus: 'interviewing', toStatus: 'archived', operatorEmpId: c.empId, note: '员工确认面谈记录，归档' } });
      // 全员归档 → 任务 FINISHED
      const [total, archived] = await Promise.all([
        tx.assessmentRecord.count({ where: { taskId: rec.taskId } }),
        tx.assessmentRecord.count({ where: { taskId: rec.taskId, status: 'archived' } }),
      ]);
      if (total === archived) await tx.assessmentTask.update({ where: { id: rec.taskId }, data: { status: 'FINISHED' } });
    });
    return { id: recordId, status: 'archived' };
  }
}
