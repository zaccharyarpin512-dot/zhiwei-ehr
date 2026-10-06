// W-05 指标库页（FR-M02-001/002/004）：分组表格 + 客观/自报标识 + 口径预览 + 新建校验
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Table, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api';

interface Indicator {
  id: number; name: string; statScope: string; sourceType: string;
  dataOwnerDeptId: number | null; unit?: string; status: string;
  objectiveBadge: string | null; group: 'objective' | 'subjective'; scopePreview: string;
}

const SCOPE_TAG: Record<string, { color: string; text: string }> = {
  current: { color: 'default', text: '当期值' },
  ytd: { color: 'orange', text: 'YTD 累计' },
  cumulative: { color: 'blue', text: '自定义累计' },
};

export default function IndicatorPage() {
  const [list, setList] = useState<Indicator[]>([]);
  const [depts, setDepts] = useState<{ id: number; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    const r = await api<Indicator[]>('/api/v1/indicators');
    setList(r);
  }, []);
  const loadDepts = useCallback(async () => {
    const walk = (nodes: any[]): any[] => (nodes || []).flatMap((n) => [{ id: n.id, name: n.name }, ...walk(n.children)]);
    const t = await api<any[]>('/api/v1/departments');
    setDepts(walk(t));
  }, []);
  useEffect(() => { load(); loadDepts(); }, [load, loadDepts]);

  const sourceType = Form.useWatch('sourceType', form);
  const statScope = Form.useWatch('statScope', form);

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', marginBottom: 12 }}>
        <Input.Search placeholder="搜索指标名称" style={{ width: 240 }} onSearch={load} allowClear />
        <span style={{ flex: 1 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建指标</Button>
      </div>
      <Table<Indicator>
        rowKey="id" size="middle" dataSource={list} pagination={false}
        columns={[
          { title: '指标名称', dataIndex: 'name', render: (v, r) => <b>{v} {r.objectiveBadge && <Tag color="blue">{r.objectiveBadge}</Tag>}</b> },
          {
            title: '数据来源', dataIndex: 'sourceType',
            render: (v) => ({
              dept_report: <Tag color="blue">🔒 部门出数</Tag>, self_report: <Tag>员工自报</Tag>,
              auto_system: <Tag color="blue">系统自动取数</Tag>, manager_review: <Tag>上级评价</Tag>,
            } as any)[v],
          },
          { title: '考核口径', dataIndex: 'statScope', render: (v) => <Tag color={SCOPE_TAG[v]?.color}>{SCOPE_TAG[v]?.text}</Tag> },
          { title: '统计窗口预览', dataIndex: 'scopePreview', render: (v) => <span style={{ color: 'var(--txt3)', fontSize: 12 }}>{v}</span> },
          { title: '状态', dataIndex: 'status', render: (v) => (v === 'ENABLED' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
        ]}
      />
      <Modal
        open={creating} title="新建指标" okText="保存" cancelText="取消"
        onCancel={() => { setCreating(false); form.resetFields(); }}
        onOk={async () => {
          const v = await form.validateFields();
          try {
            await api('/api/v1/indicators', { method: 'POST', body: JSON.stringify(v) });
            message.success('指标已创建');
            setCreating(false); form.resetFields(); load();
          } catch (e: any) { message.error(e.message); }
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ statScope: 'current', sourceType: 'self_report' }}>
          <Form.Item name="name" label="指标名称" rules={[{ required: true, message: '请输入指标名称' }]}>
            <Input placeholder="如：季度回款额" />
          </Form.Item>
          <Form.Item name="sourceType" label="数据来源" rules={[{ required: true }]}>
            <Select options={[
              { value: 'dept_report', label: '部门出数（客观指标）' },
              { value: 'self_report', label: '员工自报' },
              { value: 'manager_review', label: '上级评价' },
            ]} />
          </Form.Item>
          {/* AC2：部门出数必须选出数部门；员工自报时隐藏 */}
          {sourceType === 'dept_report' && (
            <Form.Item name="dataOwnerDeptId" label="出数部门" rules={[{ required: true, message: '数据来源为部门出数时必须选出数部门' }]}>
              <Select options={depts.map((d) => ({ value: d.id, label: d.name }))} placeholder="选择出数部门" />
            </Form.Item>
          )}
          <Form.Item name="statScope" label="考核口径" rules={[{ required: true }]}>
            <Select options={[
              { value: 'current', label: '当期值（仅本考核周期）' },
              { value: 'ytd', label: '年初至当期累计（YTD）' },
              { value: 'cumulative', label: '自定义起点累计' },
            ]} />
          </Form.Item>
          {/* AC4：口径即时预览 */}
          <div style={{ fontSize: 12, color: 'var(--txt3)', background: 'var(--pri-xxl)', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>
            {statScope === 'current' && '💡 Q3 季度考核 → 取数范围 2026-07-01 至 2026-09-30'}
            {statScope === 'ytd' && '💡 Q3 季度考核 → 取数范围 2026-01-01 至 2026-09-30'}
            {statScope === 'cumulative' && '💡 起点按所选累计起点计算（任务发起日 / 入职日 / 指定日期）'}
          </div>
          {statScope === 'cumulative' && (
            <Form.Item name="cumulativeFrom" label="累计起点" rules={[{ required: true, message: '口径为自定义累计时必须选累计起点' }]}>
              <Select options={[
                { value: 'task_start', label: '任务发起日' },
                { value: 'hire_date', label: '员工入职日' },
                { value: 'custom_date', label: '指定日期' },
              ]} />
            </Form.Item>
          )}
          <Form.Item name="unit" label="单位"><Input placeholder="如：万元、家、%" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
