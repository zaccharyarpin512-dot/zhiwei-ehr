// 考核单状态机（PRD 第 7 节硬约束）：任何代码不得允许非法状态跳转
// 全序：目标制定→目标审批(可选)→数据填报(可选)→自评→360(可选)→上级评→校准→结果确认→申诉(分支)→面谈(可选)→归档
// PRD 7.2 节点全序（data_fill 仅含客观指标时可用）
export const NODE_ORDER = [
  'goal_setting', 'goal_approval', 'data_fill', 'self_review', 'peer_review',
  'manager_review', 'calibrating', 'result_confirm', 'appealing', 'interviewing', 'archived',
];

export interface MachineNode { nodeType: string; enabled: boolean; }

// 依方案节点配置计算启用的主链路（去掉 archived——归档是终态，appealing 是分支）
export function enabledChain(schemeNodes: MachineNode[]): string[] {
  const map = new Map(schemeNodes.map((n) => [n.nodeType, n.enabled]));
  return NODE_ORDER.filter((t) => t !== 'archived' && t !== 'appealing' && (map.get(t) ?? false));
}

export function canTransit(schemeNodes: MachineNode[], from: string, to: string): boolean {
  if (from === to) return false;
  // 申诉分支：result_confirm ⇄ appealing
  if (from === 'result_confirm' && to === 'appealing') return true;
  if (from === 'appealing' && to === 'result_confirm') return true;
  // 主链路：只能走到链上的下一个节点
  const chain = enabledChain(schemeNodes);
  const i = chain.indexOf(from);
  if (i >= 0 && i < chain.length - 1 && chain[i + 1] === to) return true;
  // 主链路最后节点 → archived
  if (chain.length > 0 && chain[chain.length - 1] === from && to === 'archived') return true;
  return false;
}

export function initialStatus(schemeNodes: MachineNode[]): string {
  const chain = enabledChain(schemeNodes);
  return chain[0] || 'archived';
}
