// W-03/04 组织与员工页（FR-M01-001/002）：左树右表 + Excel 批量导入（含错误报告）
import { useCallback, useEffect, useState } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Tree, Upload, message } from 'antd';
import { UploadOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api';

interface Dept { id: number; code: string; name: string; children?: Dept[]; }
interface Emp {
  id: number; empNo: string; name: string; mobile: string; position: string;
  jobLevel?: string; status: string; departmentId: number;
}

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  ACTIVE: { color: 'green', text: '在职' },
  PROBATION: { color: 'orange', text: '试用期' },
  RESIGNED: { color: 'red', text: '离职' },
};

export default function OrgPage() {
  const [tree, setTree] = useState<Dept[]>([]);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [data, setData] = useState<{ list: Emp[]; total: number }>({ list: [], total: 0 });
  const [page, setPage] = useState(1);
  const [importResult, setImportResult] = useState<any>(null);
  const [expandedKeys, setExpandedKeys] = useState<number[]>([]);

  const loadTree = useCallback(async () => {
    const t = await api<Dept[]>('/api/v1/departments');
    setTree(t);
    // 异步加载的 treeData 无法依赖 defaultExpandAll → 手动全展开
    const allKeys = (nodes: Dept[]): number[] => (nodes || []).flatMap((n) => [n.id, ...allKeys(n.children || [])]);
    setExpandedKeys(allKeys(t));
  }, []);
  const loadEmps = useCallback(async () => {
    const q = new URLSearchParams();
    if (deptId) q.set('dept_id', String(deptId));
    if (keyword) q.set('keyword', keyword);
    if (status) q.set('status', status);
    q.set('page', String(page)); q.set('page_size', '20');
    const r = await api<{ list: Emp[]; total: number }>(`/api/v1/employees?${q}`);
    setData(r);
  }, [deptId, keyword, status, page]);

  useEffect(() => { loadTree(); }, [loadTree]);
  useEffect(() => { loadEmps(); }, [loadEmps]);

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ width: 220, background: '#fff', borderRadius: 8, padding: 12 }}>
        <Tree
          treeData={tree as any}
          fieldNames={{ title: 'name', key: 'id', children: 'children' }}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys.map(Number))}
          selectedKeys={deptId ? [deptId] : []}
          onSelect={(keys) => setDeptId(keys.length ? Number(keys[0]) : null)}
        />
      </div>
      <div style={{ flex: 1, background: '#fff', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input.Search placeholder="搜索姓名/工号/手机号" style={{ width: 240 }} onSearch={(v) => { setKeyword(v); setPage(1); }} allowClear />
          <Select
            placeholder="全部状态" allowClear style={{ width: 130 }}
            options={[{ value: 'ACTIVE', label: '在职' }, { value: 'PROBATION', label: '试用期' }, { value: 'RESIGNED', label: '离职' }]}
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
          <span style={{ flex: 1 }} />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => message.info('新建员工：见后续 WP 完善表单')}>新建员工</Button>
          <Upload
            accept=".xlsx"
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                const fd = new FormData();
                fd.append('file', file as File);
                const token = localStorage.getItem('zw-token');
                const res = await fetch('/api/v1/employees/import', {
                  method: 'POST', body: fd, headers: { Authorization: `Bearer ${token}` },
                });
                const body = await res.json();
                setImportResult(body);
                if (body.failed > 0) message.warning(`导入完成：成功 ${body.imported} 条，失败 ${body.failed} 条`);
                else message.success(`成功导入 ${body.imported} 条`);
                loadEmps();
                onSuccess?.(body);
              } catch (e: any) { message.error(e.message); onError?.(e); }
            }}
          >
            <Button icon={<UploadOutlined />}>Excel 导入</Button>
          </Upload>
        </div>
        <Table<Emp>
          rowKey="id" size="middle"
          dataSource={data.list}
          pagination={{ current: page, total: data.total, pageSize: 20, onChange: setPage, showTotal: (t) => `共 ${t} 人` }}
          columns={[
            { title: '工号', dataIndex: 'empNo' },
            { title: '姓名', dataIndex: 'name' },
            { title: '部门', dataIndex: 'departmentId', render: (v) => v || '—' },
            { title: '岗位', dataIndex: 'position' },
            { title: '职级', dataIndex: 'jobLevel', render: (v) => v || '—' },
            { title: '状态', dataIndex: 'status', render: (v) => <Tag color={STATUS_TAG[v]?.color}>{STATUS_TAG[v]?.text || v}</Tag> },
          ]}
        />
      </div>
      <Modal open={!!importResult} footer={<Button type="primary" onClick={() => setImportResult(null)}>知道了</Button>} onCancel={() => setImportResult(null)} title="导入结果">
        {importResult && (
          <>
            <p>成功 <b style={{ color: 'var(--green)' }}>{importResult.imported}</b> 条，失败 <b style={{ color: 'var(--red)' }}>{importResult.failed}</b> 条</p>
            {importResult.errors?.length > 0 && (
              <Table
                rowKey="row" size="small" pagination={false}
                dataSource={importResult.errors}
                columns={[
                  { title: '行号', dataIndex: 'row', width: 70 },
                  { title: '工号', dataIndex: 'empNo' },
                  { title: '姓名', dataIndex: 'name' },
                  { title: '失败原因', dataIndex: 'reason' },
                ]}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

// WP-6 补：单个新建员工表单（不导 Excel 也能加人）
export function EmployeeCreateButton({ deptId, onCreated }: { deptId?: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const submit = async () => {
    const v = await form.validateFields();
    try {
      await api('/api/v1/employees', { method: 'POST', body: JSON.stringify({
        empNo: v.empNo, name: v.name, mobile: v.mobile, hireDate: v.hireDate.format('YYYY-MM-DD'),
        position: v.position, departmentId: deptId ?? v.departmentId,
      }) });
      message.success('员工已创建');
      setOpen(false); form.resetFields(); onCreated();
    } catch (e: any) { message.error(e.message); }
  };
  return <>
    <Button type="primary" onClick={() => setOpen(true)}>新建员工</Button>
    <Modal open={open} onCancel={() => setOpen(false)} onOk={submit} title="新建员工">
      <Form form={form} layout="vertical">
        <Form.Item name="empNo" label="工号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="mobile" label="手机号" rules={[{ required: true }]}><Input /></Form.Item>
        <Space size="large">
          <Form.Item name="position" label="岗位" rules={[{ required: true }]}><Input style={{ width: 150 }} /></Form.Item>
          {!deptId && <Form.Item name="departmentId" label="部门ID" rules={[{ required: true }]}><InputNumber style={{ width: 120 }} /></Form.Item>}
        </Space>
        <Form.Item name="hireDate" label="入职日期" rules={[{ required: true }]}><DatePicker /></Form.Item>
      </Form>
    </Modal>
  </>;
}
