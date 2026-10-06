// WP-35 偏好（皮肤）读写 + PIP 发起
import { BusinessError, Errors } from '../common/errors';
import { ctx, mustCtx } from '../tenant-context';

export class PreferenceService {
  constructor(private prisma: any, private prisma2: any) { this.prisma = prisma2 || prisma; }

  async get() {
    const c = mustCtx();
    const p = await this.prisma.userPreference.findFirst({ where: { userId: c.userId } });
    return { theme: p?.theme ?? 'coral', notifyConfig: p?.notifyConfig ?? null };
  }

  // FR-M11-006：账号级偏好（APP 选了蓝色 Web 同样生效）
  async set(dto: { theme?: string; notifyConfig?: any }) {
    const c = mustCtx();
    const allowed = ['coral', 'sky', 'sun', 'sage'];
    if (dto.theme && !allowed.includes(dto.theme)) throw new BusinessError(40021, `主题须为 ${allowed.join('/')}`, 400);
    const p = await this.prisma.userPreference.upsert({
      where: { userId: c.userId },
      create: { tenantId: c.tenantId, userId: c.userId, theme: dto.theme ?? 'coral', notifyConfig: dto.notifyConfig ?? null },
      update: { ...(dto.theme ? { theme: dto.theme } : {}), ...(dto.notifyConfig !== undefined ? { notifyConfig: dto.notifyConfig } : {}) },
    });
    return { theme: p.theme, notifyConfig: p.notifyConfig };
  }

  // FR-M07-002 PIP：C/D 级一键发起（留痕 + 员工待办 + 到期提醒占位）
  async pip(recordId: number, dto: { goals: string; deadline: string }) {
    const tid = mustCtx().tenantId;
    const c = ctx();
    const rec = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId, tenantId: tid } });
    if (!rec) throw Errors.NOT_FOUND('考核单不存在');
    if (!['C', 'D'].includes(rec.grade ?? '')) throw new BusinessError(40919, '仅 C/D 级可发起 PIP', 409);
    if (!dto.goals || dto.goals.trim().length < 5) throw new BusinessError(40022, '改进目标必填（≥5 字）', 400);
    await this.prisma.recordStatusLog.create({ data: { tenantId: tid, recordId, fromStatus: rec.status, toStatus: rec.status, operatorEmpId: c?.empId ?? null, note: `发起 PIP：${dto.goals.slice(0, 60)}（期限 ${dto.deadline}）` } });
    const emp = await this.prisma.employee.findFirst({ where: { id: rec.empId } });
    if (emp?.userId) {
      await this.prisma.todo.create({ data: { tenantId: tid, userId: emp.userId, bizType: 'pip', bizId: String(recordId), title: `绩效改进计划（PIP）：${dto.goals.slice(0, 30)}`, actionUrl: `/records/${recordId}` } });
    }
    return { recordId, pip: { goals: dto.goals, deadline: dto.deadline, status: 'active' } };
  }
}
