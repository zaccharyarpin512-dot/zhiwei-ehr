import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Modal, Select, Space, Steps, Table, Tag } from 'antd';
import { api } from '../api';

const NODE_OPTIONS = [
  { value: 'goal_setting', label: '目标制定' },
  { value: 'goal_approval', label: '目标审批' },
  { value: 'data_fill', label: '数据填报' },
  { value: 'self_review', label: '自评' },
  { value: 'peer_review', label: '360环评' },
  { value: 'manager_review', label: '上级评价' },
  { value: 'calibrating', label: '校准' },
  { value: 'result_confirm', label: '结果确认' },
  { value: 'appealing', label: '申诉' },
  { value: 'interviewing', label: '面谈' },
];

export default function SchemePage() {
  const [list, setList] = useState<any[]>([]);
  const [indicators, setIndicators] = useState<any[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setList(await api<any[]>('/api/v1/schemes'));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<any[]>('/api/v1/indicators?include_disabled=false').then(setIndicators); }, []);

  const resetWizard = () => { setWizardOpen(true); setStep(0); setPreview(null); form.resetFields(); form.setFieldsValue({ mode: 'kpi', periodType: 'quarter', nodes: ['goal_setting', 'self_review', 'manager_review', 'calibrating', 'result_confirm'] }); };

  // 第 2 步：选指标设权重（客观/自报自动分组）
  const selIndicators = Form.useWatch('indicators', form) || [];
  const weightSum = selIndicators.reduce((a: number, i: any) => a + (Number(i?.weight) || 0), 0);

  const doPreview = async () => {
    const v = form.getFieldsValue();
    const r = await api<any>('/api/v1/schemes/preview-scope', { method: 'POST', body: JSON.stringify({ scopeFilter: v.scopeFilter || {} }) });
    setPreview(r);
  };

  const doSave = async () => {
    const v = await form.validateFields();
    if (Number(weightSum.toFixed(2)) !== 100 && v.indicators?.length) {
      return message.error(`KPI 权重合计必须为 100%，当前 ${weightSum.toFixed(1)}%`);
    }
    try {
      await api('/api/v1/schemes', { method: 'POST', body: JSON.stringify({
        name: v.name, mode: v.mode, periodType: v.periodType,
        scopeFilter: v.scopeFilter || {}, nodes: v.nodes.map((n: string, i: number) => ({ nodeType: n, seq: i + 1 })),
        indicators: v.indicators, reviewers: v.reviewers || [{ reviewerType: 'self', weight: 20 }, { reviewerType: 'manager', weight: 80 }],
        gradeRules: v.gradeRules || [
          { grade: 'S', minScore: 90, maxScore: 100, sortNo: 1 }, { grade: 'A', minScore: 80, maxScore: 89.99, sortNo: 2 },
          { grade: 'B', minScore: 70, maxScore: 79.99, sortNo: 3 }, { grade: 'C', minScore: 60, maxScore: 69.99, sortNo: 4 },
          { grade: 'D', minScore: 0, maxScore: 59.99, sortNo: 5 },
        ],
      }) });
      message.success('方案已保存（草稿）');
      setWizardOpen(false);
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const copy = async (id: number) => { await api(`/api/v1/schemes/${id}/copy`, { method: 'POST' }); message.success('已复制为新草稿'); load(); };

  return (
    <Card title="绩效方案" extra={<Button type="primary" onClick={resetWizard}>新建方案</Button>}>
      <Table rowKey="id" dataSource={list} pagination={false} columns={[
        { title: '名称', dataIndex: 'name' },
        { title: '模式', dataIndex: 'mode', render: (m) => <Tag>{m}</Tag> },
        { title: '周期', dataIndex: 'periodType' },
        { title: '状态', dataIndex: 'status', render: (s) => <Tag color={s === 'LOCKED' ? 'orange' : s === 'DISABLED' ? 'default' : 'green'}>{s}</Tag> },
        { title: '操作', render: (_, r: any) => <Space><Button size="small" onClick={() => copy(r.id)}>复制</Button></Space> },
      ]} />

      <Modal open={wizardOpen} onCancel={() => setWizardOpen(false)} width={860} footer={null} title="方案配置向导（5 步）">
        <Steps current={step} items={[{ title: '基本信息' }, { title: '考核内容' }, { title: '评价关系' }, { title: '流程节点' }, { title: '计分与等级' }]} style={{ marginBottom: 24 }} />
        <Form form={form} layout="vertical">
          <div style={{ display: step === 0 ? 'block' : 'none' }}>
            <Form.Item name="name" label="方案名称" rules={[{ required: true }]}><Input placeholder="如：销售部 Q4 考核" /></Form.Item>
            <Space size="large">
              <Form.Item name="mode" label="考核模式" rules={[{ required: true }]}><Select style={{ width: 180 }} options={[{ value: 'kpi' }, { value: 'okr' }, { value: 'kpi_okr' }, { value: 'e360' }, { value: 'kpi_360' }]} /></Form.Item>
              <Form.Item name="periodType" label="周期类型" rules={[{ required: true }]}><Select style={{ width: 120 }} options={[{ value: 'month', label: '月度' }, { value: 'quarter', label: '季度' }, { value: 'half_year', label: '半年度' }, { value: 'year', label: '年度' }]} /></Form.Item>
            </Space>
            <Form.Item label="适用范围（留空=全员）">
              <Space>
                <Form.Item name={['scopeFilter', 'deptIds']} noStyle><Select mode="multiple" placeholder="按部门" style={{ width: 260 }} options={[]} /></Form.Item>
                <Button onClick={doPreview}>预览人群</Button>
              </Space>
            </Form.Item>
            {preview && <div data-testid="scope-preview">将考核 <b>{preview.count}</b> 人：{preview.employees?.map((e: any) => e.name).join('、') || '—'}</div>}
          </div>

          <div style={{ display: step === 1 ? 'block' : 'none' }}>
            <Form.List name="indicators">
              {(fields, { add, remove }) => (<>
                {fields.map((f) => {
                  const indId = form.getFieldValue(['indicators', f.name, 'indicatorId']);
                  const ind = indicators.find((i) => i.id === indId);
                  return (
                    <Space key={f.key} align="baseline">
                      <Form.Item name={[f.name, 'indicatorId']} rules={[{ required: true }]}>
                        <Select style={{ width: 300 }} showSearch optionFilterProp="label" placeholder="选择指标"
                          options={indicators.map((i) => ({ value: i.id, label: `${i.name}${i.sourceType === 'dept_report' || i.sourceType === 'auto_system' ? ' 🔒 客观' : ''}` }))} />
                      </Form.Item>
                      {ind && <Tag color={ind.sourceType === 'dept_report' ? 'blue' : 'default'}>{ind.sourceType === 'dept_report' ? `出数：${ind.dataOwnerDeptId ?? '部门'}` : '自报/评价'}</Tag>}
                      <Form.Item name={[f.name, 'weight']} rules={[{ required: true }]}><InputNumber min={0} max={100} addonAfter="%" /></Form.Item>
                      <Button danger type="text" onClick={() => remove(f.name)}>删</Button>
                    </Space>
                  );
                })}
                <Button block onClick={() => add({})}>+ 添加指标</Button>
              </>)}
            </Form.List>
            <div data-testid="weight-sum" style={{ marginTop: 12 }}>权重合计：<b style={{ color: Number(weightSum.toFixed(2)) === 100 ? 'var(--green, #00b42a)' : '#f53f3f' }}>{weightSum.toFixed(1)}%</b>（必须为 100%）</div>
          </div>

          <div style={{ display: step === 2 ? 'block' : 'none' }}>
            <Form.List name="reviewers" initialValue={[{ reviewerType: 'self', weight: 20 }, { reviewerType: 'manager', weight: 80 }]}>
              {(fields) => fields.map((f) => (
                <Space key={f.key} align="baseline">
                  <Form.Item name={[f.name, 'reviewerType']}><Select disabled style={{ width: 140 }} options={[{ value: 'self', label: '自评' }, { value: 'manager', label: '直接上级' }, { value: 'manager_up', label: '上上级' }, { value: 'peer', label: '同事互评' }, { value: 'subordinate', label: '下属评' }]} /></Form.Item>
                  <Form.Item name={[f.name, 'weight']}><InputNumber min={0} max={100} addonAfter="%" /></Form.Item>
                </Space>
              ))}
            </Form.List>
            <div style={{ color: 'var(--txt3, #86909c)' }}>默认「自评+直接上级评」，企业微信接入后可扩展互评人数配置。</div>
          </div>

          <div style={{ display: step === 3 ? 'block' : 'none' }}>
            <Form.Item name="nodes" label="流程节点（按顺序执行，客观指标自动插入「数据填报」）" rules={[{ required: true }]}>
              <Select mode="multiple" style={{ width: '100%' }} options={NODE_OPTIONS} placeholder="按顺序选择节点" />
            </Form.Item>
            <div style={{ color: 'var(--txt3, #86909c)' }}>节点推进：到期自动推进 / 全员完成即时推进（方案级配置，后续 WP 接入调度器）。</div>
          </div>

          <div style={{ display: step === 4 ? 'block' : 'none' }}>
            <div>等级规则（默认 S/A/B/C/D 五档，可调整阈值）：</div>
            <Form.List name="gradeRules" initialValue={[
              { grade: 'S', minScore: 90, maxScore: 100, sortNo: 1 }, { grade: 'A', minScore: 80, maxScore: 89.99, sortNo: 2 },
              { grade: 'B', minScore: 70, maxScore: 79.99, sortNo: 3 }, { grade: 'C', minScore: 60, maxScore: 69.99, sortNo: 4 },
              { grade: 'D', minScore: 0, maxScore: 59.99, sortNo: 5 },
            ]}>
              {(fields) => fields.map((f) => (
                <Space key={f.key} align="baseline">
                  <Form.Item name={[f.name, 'grade']}><Input style={{ width: 70 }} /></Form.Item>
                  <Form.Item name={[f.name, 'minScore']}><InputNumber addonBefore="≥" /></Form.Item>
                  <Form.Item name={[f.name, 'maxScore']}><InputNumber addonBefore="≤" /></Form.Item>
                </Space>
              ))}
            </Form.List>
            <div style={{ color: 'var(--txt3, #86909c)' }}>强制分布比例、申诉截止时间、任务贡献配置在后续冲刺接入。</div>
          </div>
        </Form>
        <Space style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
          {step < 4 && <Button type="primary" onClick={() => setStep(step + 1)}>下一步</Button>}
          {step === 4 && <Button type="primary" onClick={doSave}>保存方案</Button>}
        </Space>
      </Modal>
    </Card>
  );
}
