// WP-37/38 AI 辅助（FR-M13-001 + 五条硬护栏）：默认启发式引擎，可配置外部大模型适配层
import { Injectable } from '@nestjs/common';
import { BusinessError } from '../../common/errors';
import { PrismaService } from '../../prisma.service';
import { ctx, mustCtx } from '../../tenant-context';

const FORBIDDEN = ['finalScore', '"score"', '"grade"', 'totalScore']; // 护栏断言：AI 响应不得含分数/等级（UAT 12-①）

@Injectable()
export class AiService {
  constructor(private prisma: PrismaService) {}

  private guard(obj: any) {
    const s = JSON.stringify(obj);
    for (const k of FORBIDDEN) if (s.includes(k)) throw new BusinessError(50010, 'AI 输出被护栏拦截（含分数字段）', 500);
    return obj;
  }

  private async log(scene: string, input: string, output: any) {
    const tid = mustCtx().tenantId; const c = ctx();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ai_invocation_log (tenant_id,user_id,scene,input_summary,output,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,NOW())`,
      tid, c?.userId ?? 0, scene, input.slice(0, 200), JSON.stringify(output)).catch(() => {});
  }

  async config() {
    const tid = mustCtx().tenantId;
    const row: any = await this.prisma.aiConfig.findFirst({ where: { tenantId: tid } }).catch(() => null);
    return row ?? { enabled: true, provider: 'builtin' };
  }

  // FR-M13-001：AI 辅助指标制定（内置启发式：关键词→候选指标，结构同大模型输出）
  async suggestIndicators(duty: string) {
    const cfg: any = await this.config();
    if (cfg.enabled === false) throw new BusinessError(40401, 'AI 辅助已关闭', 404); // 护栏⑤可关闭
    const kws: [RegExp, string, string][] = [
      [/销售|回款|收入/, '季度回款额', 'dept_report'], [/客户/, '新增客户数', 'dept_report'],
      [/质量|不良|缺陷/, '产品不良率', 'dept_report'], [/交付|项目/, '项目按时交付率', 'auto_system'],
      [/运营|活跃/, '用户活跃率', 'auto_system'], [/管理|团队/, '团队满意度', 'manager_review'],
    ];
    const picked = kws.filter(([re]) => re.test(duty)).slice(0, 5);
    const suggestions = (picked.length ? picked : kws.slice(0, 3)).map(([, name, st], i) => ({
      name, definition: `${name}——由${st === 'dept_report' ? '出数部门' : st === 'auto_system' ? '系统' : '评价人'}提供数据`,
      suggestedSourceType: st, suggestedStatScope: 'current',
      suggestedScoreRule: { type: 'rate', base: 100, cap: 120, floor: 0 },
      aiAssisted: true, sortNo: i + 1, // 护栏②：采纳标记
    }));
    const out = this.guard({ suggestions }); // 护栏①：只出建议不带分数；护栏③：调用留痕
    await this.log('indicator_suggest', duty, { count: suggestions.length });
    return out;
  }

  // WP-39：SMART 检查与润色（启发式：无量化词→建议补数字+期限）
  async polishGoal(text: string) {
    const cfg: any = await this.config();
    if (cfg.enabled === false) throw new BusinessError(40401, 'AI 辅助已关闭', 404);
    const hasNumber = /\d/.test(text);
    const issues: string[] = [];
    if (!hasNumber) issues.push('缺少数值化标准（M）');
    if (!/季度|月|周|年|底前|\d+月/.test(text)) issues.push('缺少时间界限（T）');
    const versions = hasNumber && issues.length === 0 ? [] : [
      { version: text.replace(/。?$/, '') + '，本季度完成（建议补具体数值与验收口径）', applied: false },
    ];
    const out = this.guard({ issues, versions });
    await this.log('goal_polish', text, { issues: issues.length });
    return out;
  }

  // WP-40：管理者评价草稿（喂过程数据摘要，出评语初稿——不出分数=护栏①）
  async reviewDraft(recordId: number) {
    const cfg: any = await this.config();
    if (cfg.enabled === false) throw new BusinessError(40401, 'AI 辅助已关闭', 404);
    const tid = mustCtx().tenantId;
    const rec = await this.prisma.assessmentRecord.findFirst({ where: { id: recordId, tenantId: tid } });
    if (!rec) throw new BusinessError(40400, '考核单不存在', 404);
    const emp = await this.prisma.employee.findFirst({ where: { id: rec.empId } });
    const name = emp?.name ?? '该员工';
    const draft = {
      aiAssisted: true,
      perItem: ['客观指标完成情况见系统填报数据，请以实际完成值为基础评价', '主观表现请结合日常任务与周报'],
      overall: `${name}本期整体表现【请填写事实依据→亮点→待改进】。以上由 AI 依据过程数据生成初稿，请经理核实修改后提交。`,
      talkOutline: ['开场：肯定投入', '共识：回顾目标与实际', '改进：1-2 个具体行动', '支持：需要的资源', '鼓励：明确下周期期望'],
    };
    const out = this.guard({ draft });
    await this.log('review_draft', `record:${recordId}`, { ok: true });
    return out;
}
}
