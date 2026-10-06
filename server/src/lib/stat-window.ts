// 统计窗口推导（FR-M02-001 硬约束）：
//   窗口 = [口径起点, 本考核周期截止日]
//   current     → 起点 = 考核周期开始日
//   ytd         → 起点 = 本考核周期所在自然年的 1 月 1 日
//   cumulative  → 起点 = 累计起点（task_start=任务发起日 / hire_date=员工入职日 / custom_date=指定日）
export type StatScope = 'current' | 'ytd' | 'cumulative';
export type CumulativeFrom = 'task_start' | 'hire_date' | 'custom_date';

export interface WindowInput {
  statScope: StatScope;
  cumulativeFrom?: CumulativeFrom | null;
  periodStart: Date;   // 考核周期开始日
  periodEnd: Date;     // 考核周期截止日
  taskStart?: Date;    // 任务发起日（cumulativeFrom=task_start）
  hireDate?: Date;     // 员工入职日（cumulativeFrom=hire_date）
  customDate?: Date;   // 指定日起（cumulativeFrom=custom_date）
}

export interface StatWindow { start: Date; end: Date; label: string; }

const fmt = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function deriveStatWindow(i: WindowInput): StatWindow {
  let start: Date;
  switch (i.statScope) {
    case 'current':
      start = i.periodStart;
      break;
    case 'ytd':
      start = new Date(i.periodEnd.getFullYear(), 0, 1);
      break;
    case 'cumulative': {
      const src =
        i.cumulativeFrom === 'task_start' ? i.taskStart :
        i.cumulativeFrom === 'hire_date' ? i.hireDate :
        i.cumulativeFrom === 'custom_date' ? i.customDate : undefined;
      if (!src) throw new Error('CUMULATIVE_FROM_REQUIRED');
      start = src;
      break;
    }
    default:
      throw new Error('UNKNOWN_STAT_SCOPE');
  }
  const end = i.periodEnd;
  const scopeLabel = i.statScope === 'current' ? '当期值' : i.statScope === 'ytd' ? '年初至当期累计(YTD)' : '自定义起点累计';
  return { start, end, label: `口径：${scopeLabel}｜取数范围：${fmt(start)} ~ ${fmt(end)}` };
}

// 按计分规则自动计分（FR-M05-008）：完成率×base，封顶 cap、封底 floor
export interface ScoreRule { type: 'rate'; base: number; cap: number; floor: number; }
export function autoScore(rule: ScoreRule, target: number, actual: number): number {
  if (target <= 0) throw new Error('TARGET_MUST_BE_POSITIVE');
  const raw = (actual / target) * rule.base;
  return Math.min(rule.cap, Math.max(rule.floor, Math.round(raw * 100) / 100));
}
