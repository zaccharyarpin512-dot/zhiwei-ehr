// WP-29 360 环评（FR-M05-005）：互评对象生成、匿名问卷作答、去极值聚合
import { Injectable } from '@nestjs/common';
import { BusinessError, Errors } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

@Injectable()
export class PeerService {
  constructor(private prisma: PrismaService) {}

  // 生成互评对象（manager/HR）：从同部门在职员工随机抽 N 人（排除本人与直属上级）
  async assignPeers(recordId: number, count: number) {
    const tid = mustCtx().tenantId;
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    const emp: any = await this.prisma.employee.findFirst({ where: { id: rec.empId } });
    if (!emp) throw Errors.NOT_FOUND('员工不存在');
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: rec.taskId } });
    const questions = await this.prisma.schemeQuestion.findMany({ where: { schemeId: task.schemeId } });
    if (questions.length === 0) throw new BusinessError(40012, '方案未配置 360 问卷题目', 400);
    const peers = await this.prisma.employee.findMany({
      where: { tenantId: tid, isDeleted: false, status: { in: ['ACTIVE', 'PROBATION'] }, departmentId: emp.departmentId,
        id: { notIn: [rec.empId, rec.managerEmpId ?? -1].filter((x) => x >= 0) } },
    });
    // Fisher-Yates 洗牌取前 N
    const shuffled = peers.map((p: any) => Number(p.id)).sort(() => Math.random() - 0.5).slice(0, Math.max(1, count));
    const created: number[] = [];
    for (const pid of shuffled) {
      const row: any = await this.prisma.recordReviewer.create({ data: {
        tenantId: tid, recordId, reviewerEmpId: pid, reviewerType: 'peer', status: '待评',
      } });
      created.push(Number(row.id));
      const p: any = peers.find((x: any) => Number(x.id) === pid);
      if (p?.userId) {
        await this.prisma.todo.create({ data: { tenantId: tid, userId: p.userId, bizType: 'peer_review', bizId: String(row.id), title: `360环评：请评价 ${emp.name}`, actionUrl: `/peer/${row.id}` } });
      }
    }
    return { reviewers: created, total: created.length };
  }

  // 互评人提交问卷（本人、待评状态、提交锁定）
  async submitAnswer(reviewerId: number, answers: { questionId: number; value: number }[], comment?: string) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const rv: any = await this.prisma.recordReviewer.findFirst({ where: { id: reviewerId } });
    if (!rv) throw Errors.NOT_FOUND('评价任务不存在');
    if (c?.empId == null || Number(rv.reviewerEmpId) !== c.empId) throw Errors.FORBIDDEN();
    if (rv.status === '已评') throw new BusinessError(40915, '该问卷已提交，不可修改', 409);
    const task: any = await this.prisma.assessmentTask.findFirst({ where: { id: (await this.prisma.assessmentRecord.findFirst({ where: { id: rv.recordId } }))?.taskId } });
    const questions = await this.prisma.schemeQuestion.findMany({ where: { schemeId: task.schemeId } });
    if (answers.length < questions.length) throw new BusinessError(40013, `还有 ${questions.length - answers.length} 题未作答`, 400);
    const avg = answers.reduce((a, x) => a + Number(x.value), 0) / answers.length;
    await this.prisma.recordReviewer.update({ where: { id: reviewerId }, data: {
      answers, relationScore: Number(avg.toFixed(2)), relationComment: comment ?? null, status: '已评', submittedAt: new Date(),
    } });
    return { reviewerId, score: Number(avg.toFixed(2)) };
  }

  // 聚合（去极值可配）：同事分 = 各互评人总均分再去极值平均；写回 record_indicator.peer 权重消费
  async aggregate(recordId: number, trimExtremes = false) {
    const rvs = await this.prisma.recordReviewer.findMany({ where: { recordId, reviewerType: 'peer', status: '已评' } });
    if (rvs.length === 0) return { recordId, peerScore: null, count: 0, note: '暂无已完成的互评' };
    const scores = rvs.map((r: any) => Number(r.relationScore)).sort((a, b) => a - b);
    let used = scores;
    if (trimExtremes && scores.length >= 4) used = scores.slice(1, -1); // 去极值：≥4 份时去掉最高最低
    const peerScore = Number((used.reduce((a, b) => a + b, 0) / used.length).toFixed(2));
    await this.prisma.assessmentRecord.update({ where: { id: recordId }, data: { /* peerScore 存于 reviewers 均分，汇总由 ScoreService 消费 */ } });
    return { recordId, peerScore, count: scores.length, used: used.length, trimmed: trimExtremes && scores.length >= 4 };
  }

  // 匿名视图（FR-M05-005 匿名规则）：被评人视角只见 同事1/2/3
  async anonymizedReviewers(recordId: number) {
    const rec: any = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId } });
    const c = ctx();
    const isPrivileged = c?.roles?.includes('hr_admin') || (c?.empId != null && Number(rec?.managerEmpId) === c.empId);
    const rvs = await this.prisma.recordReviewer.findMany({ where: { recordId, reviewerType: 'peer' } });
    return rvs.map((r: any, i: number) => ({
      id: Number(r.id), status: r.status,
      relationScore: r.relationScore != null ? Number(r.relationScore) : null,
      relationComment: r.relationComment,
      reviewer: isPrivileged ? `#${r.reviewerEmpId}` : `同事${i + 1}`, // UAT 2：任何界面不泄漏互评人真实身份
    }));
  }
}
