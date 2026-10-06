import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, message, Modal, Select, Space, Table, Tag, Upload } from 'antd';
import { api } from '../api';

// WP-15 数据填报工作台（W-17：填报人视角 + HR 视角）
export default function DataFillPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [viewBy, setViewBy] = useState<'employee' | 'indicator'>('employee');
  const [drafts, setDrafts] = useState<Record<string, { actualValue?: number; evidenceNote?: string }>>({});

  const load = useCallback(async () => {
    setOrders(await api<any[]>('/api/v1/data-fill-orders'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (id: number) => {
    setDrafts({});
    setDetail(await api<any>(`/api/v1/data-fill-orders/${id}`));
  };

  const setDraft = (itemId: string, patch: any) => setDrafts((d) => ({ ...d, [itemId]: { ...d[itemId], ...patch } }));

  const submit = async () => {
    if (!detail) return;
    const rows = detail.items.filter((r: any) => drafts[r.id]?.actualValue !== undefined);
    if (rows.length === 0) return message.warning('请至少填写一行实际完成值');
    try {
      await api(`/api/v1/data-fill-orders/${detail.id}/submit`, { method: 'POST', body: JSON.stringify({ items: rows.map((r: any) => ({ recordId: r.recordId, indicatorId: r.indicatorId, actualValue: drafts[r.id].actualValue, evidenceNote: drafts[r.id].evidenceNote })) }) });
      message.success('填报已提交，系统将自动计分');
      setDetail(null);
      load();
    } catch (e: any) { message.error(e.message); }
  };

  const statusTag: Record<string, JSX.Element> = {
    PENDING: <Tag color="blue">待填报</Tag>, SUBMITTED: <Tag color="green">已提交</Tag>,
    RETURNED: <Tag color="red">已退回</Tag>, SETTLED: <Tag color="orange">已结算(兜底)</Tag>,
  };

  return (
    <Card title="数据填报工作台（FR-M05-008）">
      <Table rowKey="id" dataSource={orders} pagination={false} columns={[
        { title: '填报单号', dataIndex: 'id', render: (id) => `DF-${id}` },
        { title: '任务', dataIndex: 'taskName' },
        { title: '出数部门', dataIndex: 'deptName' },
        { title: '填报人', dataIndex: 'fillerName' },
        { title: '进度', render: (_, r: any) => `${r.filledRows}/${r.totalRows}` },
        { title: '状态', dataIndex: 'status', render: (s) => statusTag[s] || s },
        { title: '操作', render: (_, r: any) => <Space>
          {(r.status === 'PENDING' || r.status === 'RETURNED') && <Button size="small" type="primary" onClick={() => open(r.id)}>填报</Button>}
          <Button size="small" onClick={() => open(r.id)}>查看</Button>
        </Space> },
      ]} />

      <Modal open={!!detail} onCancel={() => setDetail(null)} width={920} title={detail ? `填报单 DF-${detail.id}（口径与统计窗口已固化，修改需走退回重填）` : ''}
        footer={detail && (detail.status === 'PENDING' || detail.status === 'RETURNED') ? [<Button key="ok" type="primary" onClick={submit}>整单提交并计分</Button>] : null}>
        {detail && (<>
          <Space style={{ marginBottom: 12 }}>
            视图：<Select value={viewBy} onChange={setViewBy} style={{ width: 140 }} options={[{ value: 'employee', label: '按被考核人' }, { value: 'indicator', label: '按指标' }]} />
            <Upload accept=".xlsx" showUploadList={false} beforeUpload={() => { message.info('Excel 批量导入在 Sprint 3 接入模板校验（40004）'); return false; }}>
              <Button>Excel 导入</Button>
            </Upload>
          </Space>
          <Table rowKey="id" size="small" dataSource={detail.items} pagination={false} columns={[
            { title: viewBy === 'employee' ? '被考核人' : '指标', render: (_, r: any) => viewBy === 'employee' ? r.employeeName : r.indicatorName },
            { title: viewBy === 'employee' ? '指标' : '被考核人', render: (_, r: any) => viewBy === 'employee' ? r.indicatorName : r.employeeName },
            { title: '目标值', render: (_, r: any) => r.targetValue ?? '—' },
            { title: '口径', render: (_, r: any) => <Tag>{r.statScope}</Tag>, width: 90 },
            { title: '统计窗口', dataIndex: 'windowLabel', width: 200 },
            { title: '实际完成值', width: 140, render: (_, r: any) =>
              (detail.status === 'PENDING' || detail.status === 'RETURNED')
                ? <Input type="number" value={drafts[r.id]?.actualValue ?? (r.actualValue ?? '')} onChange={(e) => setDraft(r.id, { actualValue: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="填报" />
                : r.actualValue ?? '—' },
            { title: '佐证说明', render: (_, r: any) =>
              (detail.status === 'PENDING' || detail.status === 'RETURNED')
                ? <Input value={drafts[r.id]?.evidenceNote ?? (r.evidenceNote ?? '')} onChange={(e) => setDraft(r.id, { evidenceNote: e.target.value })} placeholder="可附说明" />
                : r.evidenceNote || '—' },
            { title: '异议', width: 90, render: (_, r: any) => r.objection ? <Tag color="orange">有异议</Tag> : '—' },
          ]} />
        </>)}
      </Modal>
    </Card>
  );
}
