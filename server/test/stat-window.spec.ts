// FR-M02-001 硬约束：统计窗口推导规则 + 自动计分（纯函数单元测试）
import { deriveStatWindow, autoScore } from '../src/lib/stat-window';

const D = (s: string) => new Date(s + 'T00:00:00');
const fmt = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('统计窗口推导（FR-M02-001 硬约束）', () => {
  it('当期值：Q3 季考 → 7/1~9/30', () => {
    const w = deriveStatWindow({ statScope: 'current', periodStart: D('2026-07-01'), periodEnd: D('2026-09-30') });
    expect(fmt(w.start)).toBe('2026-07-01');
    expect(fmt(w.end)).toBe('2026-09-30');
  });

  it('YTD：Q3 季考 → 1/1~9/30（UAT9-①）', () => {
    const w = deriveStatWindow({ statScope: 'ytd', periodStart: D('2026-07-01'), periodEnd: D('2026-09-30') });
    expect(fmt(w.start)).toBe('2026-01-01');
    expect(fmt(w.end)).toBe('2026-09-30');
  });

  it('YTD：同一指标 8 月月考 → 1/1~8/31（同一指标不同考核频率窗口自动变化）', () => {
    const w = deriveStatWindow({ statScope: 'ytd', periodStart: D('2026-08-01'), periodEnd: D('2026-08-31') });
    expect(fmt(w.start)).toBe('2026-01-01');
    expect(fmt(w.end)).toBe('2026-08-31');
  });

  it('自定义累计·入职日：起点=员工入职日', () => {
    const w = deriveStatWindow({
      statScope: 'cumulative', cumulativeFrom: 'hire_date',
      periodStart: D('2026-07-01'), periodEnd: D('2026-09-30'), hireDate: D('2026-04-15'),
    });
    expect(fmt(w.start)).toBe('2026-04-15');
    expect(fmt(w.end)).toBe('2026-09-30');
  });

  it('自定义累计·任务发起日：起点=任务发起日', () => {
    const w = deriveStatWindow({
      statScope: 'cumulative', cumulativeFrom: 'task_start',
      periodStart: D('2026-07-01'), periodEnd: D('2026-09-30'), taskStart: D('2026-06-20'),
    });
    expect(fmt(w.start)).toBe('2026-06-20');
  });

  it('自定义累计未选起点 → 抛错（FR-M02-001 校验）', () => {
    expect(() => deriveStatWindow({ statScope: 'cumulative', periodStart: D('2026-07-01'), periodEnd: D('2026-09-30') }))
      .toThrow('CUMULATIVE_FROM_REQUIRED');
  });

  it('label 含口径与窗口描述（AC4 预览文案）', () => {
    const w = deriveStatWindow({ statScope: 'ytd', periodStart: D('2026-07-01'), periodEnd: D('2026-09-30') });
    expect(w.label).toContain('年初至当期累计');
    expect(w.label).toContain('2026-01-01 ~ 2026-09-30');
  });
});

describe('自动计分（FR-M05-008：完成率×base，封顶/封底）', () => {
  const rule = { type: 'rate' as const, base: 100, cap: 120, floor: 0 };
  it('480/500 → 96 分', () => expect(autoScore(rule, 500, 480)).toBe(96));
  it('600/500 → 封顶 120', () => expect(autoScore(rule, 500, 600)).toBe(120));
  it('0/500 → 封底 0', () => expect(autoScore(rule, 500, 0)).toBe(0));
  it('目标值为 0 → 抛错', () => expect(() => autoScore(rule, 0, 100)).toThrow());
});
