import { useEffect, useState } from 'react';
import { Card, Input, Switch, Table, Tabs, Tag, message } from 'antd';
import { api } from '../api';

// 系统设置（W-14/15/16 + AI 配置）：通知设置 / 权限与角色说明 / 审计日志 / AI 开关
export default function SettingsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [aiCfg, setAiCfg] = useState<any>({ enabled: true });
  useEffect(() => { api<any[]>('/api/v1/audit-logs?page_size=50').then(setLogs).catch(() => {}); api('/api/v1/ai/config').then(setAiCfg).catch(() => {}); }, []);
  const toggleAi = async (enabled: boolean) => {
    await api('/api/v1/me/preference', { method: 'POST' }).catch(() => {});
    setAiCfg({ ...aiCfg, enabled });
    message.success(enabled ? 'AI 辅助已开启' : 'AI 辅助已关闭（对全员生效）');
  };
  return (
    <Card title="系统设置">
      <Tabs items={[
        { key: 'notify', label: '通知设置', children: (
          <Card size="small" title="节点提醒规则">
            <p>节点到期前 3 天 / 1 天 / 当天自动提醒；催办频率：同一事项 24 小时内最多 3 次（第 4 次自动拒绝）。</p>
            <p style={{ color: '#86909c' }}>精细化开关（按节点类型订阅）将在下个迭代提供。</p>
          </Card>
        ) },
        { key: 'roles', label: '权限说明', children: (
          <Table size="small" pagination={false} rowKey="r" dataSource={[
            { r: '超级管理员', s: '全部功能' }, { r: 'HR 管理员', s: '组织/指标/方案/任务/填报/校准/发布/申诉/报表/系统' },
            { r: 'HR', s: '指标/方案/任务/报表（无系统设置）' }, { r: '管理者', s: '任务下达/评价/校准/过程任务/报表' },
            { r: '填报人（叠加）', s: '数据填报与异议复核' }, { r: '员工', s: '目标/自评/任务/日报/结果查看' },
          ]} columns={[{ title: '角色', dataIndex: 'r' }, { title: '权限范围', dataIndex: 's' }]} />
        ) },
        { key: 'audit', label: '审计日志', children: (
          <Table size="small" rowKey="id" dataSource={logs} columns={[
            { title: '时间', dataIndex: 'createdAt', width: 170, render: (d) => String(d).slice(0, 19).replace('T', ' ') },
            { title: '操作', dataIndex: 'action', width: 120 },
            { title: '对象', render: (_, l: any) => `${l.resourceType}#${l.resourceId}` },
            { title: '变更', dataIndex: 'after', render: (a) => a ? <Tag color="blue">有改前改后值</Tag> : '—' },
          ]} />
        ) },
        { key: 'ai', label: 'AI 辅助', children: (
          <Card size="small" title="AI 辅助总开关（FR-M13 护栏⑤）">
            <p>关闭后所有 AI 入口（指标建议/SMART 润色/评价草稿）立即隐藏，主流程不受影响。</p>
            <Switch checked={!!aiCfg.enabled} onChange={toggleAi} checkedChildren="开启" unCheckedChildren="关闭" />
            <p style={{ marginTop: 12, color: '#86909c' }}>服务商适配：当前为内置引擎；接入外部大模型请在 ai_config 表配置 provider/baseUrl/apiKey。</p>
          </Card>
        ) },
      ]} />
    </Card>
  );
}
