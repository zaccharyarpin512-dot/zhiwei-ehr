import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, DatePicker, Form, Input, message, Modal, Progress, Row, Select, Space, Statistic, Table, Tag } from 'antd';
import { api } from '../api';

const NODE_LABEL: Record<string, string> = {
  goal_setting: '目标制定', goal_approval: '目标审批', data_fill: '数据填报', self_review: '自评',
  peer_review: '360环评', manager_review: '上级评价', calibrating: '校准', result_confirm: '结果确认',
  appealing: '申诉中', interviewing: '面谈', archived: '已归档',
};

// WP-19 任务列表 + 任务详情（W-08/W-09：节点漏斗、人员明细、催办、发布）
export default function TaskPage() {
  const [list, setList] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    const l = await api<any[]>('/api/v1/tasks');
    setList(l);
  }, []);
  useEffect(() => { load(); }, [load]);

  // 发起考核任务（FR-M05-001）：选方案 → 命名/定周期 → 组织快照批量生成考核单
  const openCreate = async () => {
    const sc = await api<any[]>('/api/v1/schemes');
    const usable = sc.filter((x: any) => x.status !== 'DISABLED');
    setSchemes(usable);
    if (!usable.length) {
      return Modal.info({ title: '暂无可用的方案', content: '请先在「绩效方案」页创建方案并保存（保存后即为可发起状态）。' });
    }
    setCreateOpen(true);
  };
  const create = async () => {
    const v = await form.validateFields();
    try {
      await api('/api/v1/tasks', { method: 'POST', body: JSON.stringify({
        schemeId: v.schemeId, name: v.name, period: v.period,
        startDate: v.range[0].format('YYYY-MM-DD'), endDate: v.range[1].format('YYYY-MM-DD'),
      }) });
      message.success('考核任务已发起，考核单与员工待办已生成');
      setCreateOpen(false); form.resetFields(); load();
    } catch (e: any) { message.error(e.message); }
  };

  const open = async (id: number) => {
    const d = await api<any>(`/api/v1/tasks/${id}`);
    const records = await api<any[]>(`/api/v1/tasks/${id}/records`);
    setDetail({ ...d, records });
  };

  const remind = async (ids: number[]) => {
    if (!detail) return;
    try {
      await api(`/api/v1/tasks/${detail.id}/remind`, { method: 'POST', body: JSON.stringify({ recordIds: ids }) });
      message.success(`已向 ${ids.length} 人发送催办`);
    } catch (e: any) { message.error(e.message); }
  };

  const publish = async () => {
    if (!detail) return;
    try {
      await api(`/api/v1/tasks/${detail.id}/publish`, { method: 'POST' });
      message.success('结果已发布，员工将收到通知');
      setDetail(null);
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const statuses = detail ? Object.keys(detail.byStatus || {}) : [];

  return (
    <>
      <Card title="考核任务（W-08）" extra={<Button type="primary" onClick={openCreate}>发起考核任务</Button>}>
        <Table rowKey="id" dataSource={list} pagination={false} columns={[
          { title: '任务', dataIndex: 'name' },
          { title: '周期', dataIndex: 'period' },
          { title: '起止', render: (_, r: any) => `${r.startDate?.slice(0, 10)} ~ ${r.endDate?.slice(0, 10)}` },
          { title: '进度', width: 220, render: (_, r: any) => <Progress percent={r.total ? Math.round(((r.byStatus?.archived || 0) / r.total) * 100) : 0} size="small" /> },
          { title: '状态', dataIndex: 'status', render: (s) => <Tag color={s === 'RUNNING' ? 'processing' : 'success'}>{s === 'RUNNING' ? '进行中' : '已结束'}</Tag> },
          { title: '操作', render: (_, r: any) => <Button size="small" onClick={() => open(r.id)}>详情</Button> },
        ]} />
      </Card>

      <Modal open={!!detail} onCancel={() => setDetail(null)} width={960} title={detail ? `任务详情：${detail.name}（${detail.period}）` : ''}
        footer={detail?.status === 'RUNNING' ? [
          <Button key="pub" type="primary" onClick={publish}>发布结果（存在未结异议将被拦截 40018）</Button>,
        ] : null}>
        {detail && (<>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            {statuses.map((s) => (
              <Col span={Math.max(2, Math.floor(22 / Math.max(1, statuses.length)))} key={s}>
                <Card size="small"><Statistic title={NODE_LABEL[s] || s} value={detail.byStatus[s]} /></Card>
              </Col>
            ))}
          </Row>
          <Space style={{ marginBottom: 8 }}>
            <Button onClick={() => remind(detail.records.filter((r: any) => r.status !== 'archived').map((r: any) => r.id))}>一键催办未完成</Button>
          </Space>
          <Table rowKey="id" size="small" dataSource={detail.records} pagination={false} columns={[
            { title: '员工', dataIndex: 'employeeName' },
            { title: '当前节点', dataIndex: 'status', render: (s) => <Tag color={s === 'archived' ? 'success' : 'processing'}>{NODE_LABEL[s] || s}</Tag> },
            { title: '总分', dataIndex: 'finalScore', render: (v) => v ?? '—' },
            { title: '待定', dataIndex: 'isProvisional', render: (v) => v ? <Tag color="orange">有未结异议</Tag> : '—' },
            { title: '操作', render: (_, r: any) => r.status !== 'archived' ? <Button size="small" onClick={() => remind([r.id])}>催办</Button> : null },
          ]} />
        </>)}
      </Modal>

      <Modal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} title="发起考核任务" okText="发起">
        <Form form={form} layout="vertical">
          <Form.Item name="schemeId" label="考核方案" rules={[{ required: true, message: '请选择方案' }]}>
            <Select options={schemes.map((x: any) => ({ value: x.id, label: `${x.name}（${x.mode} / ${x.periodType}）` }))} placeholder="选择方案（发起后方案自动锁定）" />
          </Form.Item>
          <Form.Item name="name" label="任务名称" rules={[{ required: true }]}><Input placeholder="如：Q4 绩效考核" /></Form.Item>
          <Form.Item name="period" label="周期标识" rules={[{ required: true }]}><Input placeholder="如：2026Q4" style={{ width: 200 }} /></Form.Item>
          <Form.Item name="range" label="起止日期" rules={[{ required: true }]}><DatePicker.RangePicker /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
