// PRD 第 7 节状态机硬约束：非法跳转必须拒绝（UAT 4）
import { canTransit, enabledChain, initialStatus } from '../src/lib/state-machine';

const ALL = (skip: string[] = []) =>
  ['goal_setting', 'goal_approval', 'data_fill', 'self_review', 'peer_review', 'manager_review', 'calibrating', 'result_confirm', 'interviewing', 'archived']
    .map((t) => ({ nodeType: t, enabled: !skip.includes(t) }));

describe('考核单状态机（PRD 7.2 硬约束）', () => {
  it('全节点启用时沿主链逐节点推进', () => {
    const n = ALL();
    expect(canTransit(n, 'goal_setting', 'goal_approval')).toBe(true);
    expect(canTransit(n, 'goal_approval', 'data_fill')).toBe(true);
    expect(canTransit(n, 'data_fill', 'self_review')).toBe(true);
    expect(canTransit(n, 'self_review', 'peer_review')).toBe(true);
    expect(canTransit(n, 'manager_review', 'calibrating')).toBe(true);
    expect(canTransit(n, 'interviewing', 'archived')).toBe(true);
  });

  it('可选节点关闭时自动跳过（无目标审批/无360 → 链上无这些节点）', () => {
    const n = ALL(['goal_approval', 'peer_review', 'interviewing']);
    expect(enabledChain(n)).toEqual(['goal_setting', 'data_fill', 'self_review', 'manager_review', 'calibrating', 'result_confirm']);
    expect(canTransit(n, 'goal_setting', 'data_fill')).toBe(true); // 跳过 goal_approval
    expect(canTransit(n, 'self_review', 'manager_review')).toBe(true); // 跳过 peer_review
    expect(canTransit(n, 'result_confirm', 'archived')).toBe(true); // 跳过 interviewing
    expect(initialStatus(n)).toBe('goal_setting');
  });

  it('非法跳转一律拒绝：跳跃/回退/自转（UAT 4）', () => {
    const n = ALL();
    expect(canTransit(n, 'goal_setting', 'self_review')).toBe(false); // 跳节点
    expect(canTransit(n, 'goal_setting', 'calibrating')).toBe(false); // 大跳
    expect(canTransit(n, 'self_review', 'goal_setting')).toBe(false); // 回退
    expect(canTransit(n, 'self_review', 'self_review')).toBe(false); // 自转
    expect(canTransit(n, 'archived', 'result_confirm')).toBe(false); // 终态不可逆
  });

  it('申诉分支：result_confirm ⇄ appealing 双向允许', () => {
    const n = ALL();
    expect(canTransit(n, 'result_confirm', 'appealing')).toBe(true);
    expect(canTransit(n, 'appealing', 'result_confirm')).toBe(true);
    expect(canTransit(n, 'appealing', 'archived')).toBe(false); // 申诉未处理不得归档
  });
});
