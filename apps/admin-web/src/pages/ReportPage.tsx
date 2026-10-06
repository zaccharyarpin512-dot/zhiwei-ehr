import { useCallback, useEffect, useState } from 'react';
import { Card, Col, Progress, Row, Select, Statistic, Table, Tabs, Tag } from 'antd';
import { api } from '../api';

const NODE_LABEL: Record<string, string> = {
  goal_setting: '目标制定', goal_approval: '目标审批', data_fill: '数据填报', self_review: '自评',
  peer_review: '360环评', manager_review: '上级评价', calibrating: '校准', result_confirm: '结果确认',
  appealing: '申诉中', interviewing: '面谈', archived: '已归档',
};

// WP-25 报表中心（W-13：进度看板 / 等级分布 / 部门对比）
export default function ReportPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskId, setTaskId] = useState<number>();
  const [progress, setProgress] = useState<any>(null);
  const [distGrade, setDistGrade] = useState<any>(null);
  const [distDept, setDistDept] = useState<any>(null);

  useEffect(() => { api<any[]>('/api/v1/tasks').then((l) => { setTasks(l); if (l[0]) setTaskId(l[0].id); }); }, []);
  const load = useCallback(async (id: number) => {
    setProgress(await api(`/api/v1/tasks/${id}/report/progress`));
    setDistGrade(await api(`/api/v1/tasks/${id}/report/distribution?by=grade`));
    setDistDept(await api(`/api/v1/tasks/${id}/report/distribution?by=dept`));
  }, []);
  useEffect(() => { if (taskId) load(taskId); }, [taskId, load]);

  const deptRows = Object.entries(distDept?.cross || {}).map(([dept, grades]: any) => ({ dept, ...grades }));

  return (
    <Card title="报表中心（FR-M09）" extra={<Select style={{ width: 260 }} value={taskId} onChange={setTaskId} options={tasks.map((t) => ({ value: t.id, label: `${t.name}（${t.period}）` }))} />}>
      <Tabs items={[
        { key: 'progress', label: '进度看板', children: progress && (<>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={4}><Card size="small"><Statistic title="总人数" value={progress.total} /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="已归档" value={progress.byStatus?.archived || 0} /></Card></Col>
            <Col span={6}><Card size="small"><Progress percent={progress.total ? Math.round(((progress.byStatus?.archived || 0) / progress.total) * 100) : 0} /></Card></Col>
          </Row>
          <b>各节点分布</b>
          <Row gutter={16} style={{ margin: '12px 0' }}>
            {Object.entries(progress.byStatus || {}).map(([s, n]: any) => (
              <Col span={3} key={s}><Card size="small"><Statistic title={NODE_LABEL[s] || s} value={n} /></Card></Col>
            ))}
          </Row>
          <b>未完成名单（催办数据源）</b>
          <Table rowKey="recordId" size="small" style={{ marginTop: 8 }} dataSource={progress.unfinished} pagination={false} columns={[
            { title: '员工', dataIndex: 'employeeName' },
            { title: '当前节点', dataIndex: 'status', render: (s) => <Tag color="processing">{NODE_LABEL[s] || s}</Tag> },
          ]} />
        </>) },
        { key: 'grade', label: '等级分布', children: distGrade && (
          <Table rowKey="grade" size="small" pagination={false} dataSource={Object.entries(distGrade.distribution || {}).map(([grade, count]) => ({ grade, count }))}
            columns={[{ title: '等级', dataIndex: 'grade', render: (g) => <Tag color={g === 'S' ? 'gold' : g === 'A' ? 'green' : g === 'D' ? 'red' : 'blue'}>{g}</Tag> }, { title: '人数', dataIndex: 'count' }]} />
        ) },
        { key: 'dept', label: '部门对比', children: distDept && (
          <Table rowKey="dept" size="small" pagination={false} dataSource={deptRows}
            columns={[{ title: '部门', dataIndex: 'dept' }, ...Object.keys(distGrade?.distribution || {}).map((g) => ({ title: g, dataIndex: g, render: (v: number) => v ?? 0 }))]} />
        ) },
      ]} />
    </Card>
  );
}
