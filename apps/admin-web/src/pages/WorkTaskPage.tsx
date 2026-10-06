import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, message, DatePicker } from 'antd';
import { api } from '../api';

// 过程任务管理 + 悬赏集市（W-18/W-19：下达/三视图/验收/集市认领）
export default function WorkTaskPage() {
  const [view, setView] = useState('mine');
  const [list, setList] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async (v: string) => {
    setList(await api<any[]>(`/api/v1/work-tasks?view=${v}`));
  }, []);
  useEffect(() => { load(view); }, [view, load]);

  const create = async () => {
    const v = await form.validateFields();
    try {
      await api('/api/v1/work-tasks', { method: 'POST', body: JSON.stringify({
        title: v.title, assigneeEmpId: v.assigneeEmpId ?? undefined, priority: v.priority,
        dueDate: v.dueDate ? v.dueDate.format('YYYY-MM-DD') : undefined,
        rewardPoints: v.rewardPoints ?? undefined, scope: v.scope,
      }) });
      message.success(v.rewardPoints ? '悬赏任务已发布到集市' : '任务已下达');
      setCreateOpen(false);
      form.resetFields();
      load(view);
    } catch (e: any) { message.error(e.message); }
  };

  const transition = async (id: number, to: string) => {
    try { await api(`/api/v1/work-tasks/${id}/transition`, { method: 'POST', body: JSON.stringify({ to }) }); message.success('操作成功'); load(view); }
    catch (e: any) { message.error(e.message); }
  };
  const claim = async (id: number) => {
    try { await api(`/api/v1/work-tasks/${id}/claim`, { method: 'POST' }); message.success('认领成功，加油！'); load(view); }
    catch (e: any) { message.error(e.message); }
  };

  const PRI: Record<string, JSX.Element> = { urgent: <Tag color="red">紧急</Tag>, high: <Tag color="orange">高</Tag>, medium: <Tag color="blue">中</Tag>, low: <Tag color="default">低</Tag> };
  const ST: Record<string, JSX.Element> = {
    assigned: <Tag>已指派</Tag>, market_open: <Tag color="gold">🪙 集市待认领</Tag>, in_progress: <Tag color="processing">进行中</Tag>,
    submitted: <Tag color="blue">待验收</Tag>, accepted: <Tag color="success">已验收</Tag>, rejected: <Tag color="red">已驳回</Tag>,
  };

  return (
    <Card title="过程任务与悬赏集市" extra={<Button type="primary" onClick={() => setCreateOpen(true)}>下达任务 / 发布悬赏</Button>}>
      <Tabs activeKey={view} onChange={(k) => setView(k as string)} items={[
        { key: 'mine', label: '我的任务' }, { key: 'published', label: '我发布的' }, { key: 'market', label: '任务集市' },
      ]} />
      <Table rowKey="id" dataSource={list} pagination={false} columns={[
        { title: '任务', dataIndex: 'title', render: (t, r: any) => <Space>{t}{Number(r.rewardPoints) > 0 && <Tag color="gold">🪙{r.rewardPoints}</Tag>}</Space> },
        { title: '优先级', dataIndex: 'priority', width: 90, render: (p) => PRI[p] || p },
        { title: '截止', dataIndex: 'dueDate', width: 120, render: (d) => d ? String(d).slice(0, 10) : '—' },
        { title: '状态', dataIndex: 'status', width: 120, render: (s) => ST[s] || s },
        { title: '操作', width: 200, render: (_, r: any) => <Space>
          {r.status === 'market_open' && <Button size="small" type="primary" onClick={() => claim(r.id)}>认领</Button>}
          {r.status === 'in_progress' && view === 'mine' && <Button size="small" onClick={() => transition(r.id, 'submitted')}>提交验收</Button>}
          {r.status === 'submitted' && view === 'published' && <>
            <Button size="small" type="primary" onClick={() => transition(r.id, 'accepted')}>验收通过</Button>
            <Button size="small" danger onClick={() => transition(r.id, 'rejected')}>驳回</Button>
          </>}
        </Space> },
      ]} />

      <Modal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} title="下达任务 / 发布悬赏" okText={Form.useWatch('rewardPoints', form) ? '发布悬赏' : '下达'}>
        <Form form={form} layout="vertical" initialValues={{ priority: 'medium', scope: 'dept' }}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true }]}><Input placeholder="如：整理 Q4 客户清单" /></Form.Item>
          <Space size="large">
            <Form.Item name="priority" label="优先级"><Select style={{ width: 110 }} options={[{ value: 'urgent', label: '紧急' }, { value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} /></Form.Item>
            <Form.Item name="dueDate" label="截止日期"><DatePicker /></Form.Item>
          </Space>
          <Form.Item name="assigneeEmpId" label="指派给（留空+填悬赏积分=发布到集市）"><InputNumber min={1} placeholder="员工ID" style={{ width: 160 }} /></Form.Item>
          <Space size="large">
            <Form.Item name="rewardPoints" label="悬赏积分"><InputNumber min={0} max={500} /></Form.Item>
            <Form.Item name="scope" label="可见范围"><Select style={{ width: 130 }} options={[{ value: 'dept', label: '本部门' }, { value: 'company', label: '全公司' }]} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

// 工作台真数据版（W-02：待办/进行中的考核任务/快捷入口）
export function Dashboard() {
  const [todos, setTodos] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => { api<any[]>('/api/v1/todos?status=待处理').then(setTodos).catch(() => {}); api<any[]>('/api/v1/tasks').then(setTasks).catch(() => {}); }, []);
  const running = tasks.filter((t) => t.status === 'RUNNING');
  return (
    <Row gutter={16}>
      <Col span={8}><Card><Statistic title="我的待办" value={todos.length} /></Card></Col>
      <Col span={8}><Card><Statistic title="进行中考核任务" value={running.length} /></Card></Col>
      <Col span={8}><Card><Statistic title="历史任务" value={tasks.length - running.length} /></Card></Col>
      <Col span={24} style={{ marginTop: 16 }}>
        <Card title="进行中考核任务" size="small">
          {running.length === 0 ? <div style={{ color: 'var(--txt3, #86909c)' }}>暂无进行中的考核任务</div> : (
            <Table rowKey="id" size="small" pagination={false} dataSource={running} columns={[
              { title: '任务', dataIndex: 'name' }, { title: '周期', dataIndex: 'period' },
              { title: '进度', render: (_, r: any) => `${r.byStatus?.archived || 0}/${r.total || 0} 已归档` },
            ]} />
          )}
        </Card>
      </Col>
    </Row>
  );
}
