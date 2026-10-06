import io

# ---------- TaskPage：草稿流程 + 部门/人员选择 ----------
p = r'C:\Users\86132\Desktop\智未EHR\zhiwei-ehr\apps\admin-web\src\pages\TaskPage.tsx'
s = io.open(p, encoding='utf-8').read()

old = """      await api('/api/v1/tasks', { method: 'POST', body: JSON.stringify({
        schemeId: v.schemeId, name: v.name, period: v.period,
        startDate: v.range[0].format('YYYY-MM-DD'), endDate: v.range[1].format('YYYY-MM-DD'),
      }) });
      message.success('考核任务已发起，考核单与员工待办已生成');
      setCreateOpen(false); form.resetFields(); load();"""
new = """      const payload: any = {
        schemeId: v.schemeId, name: v.name, period: v.period,
        startDate: v.range[0].format('YYYY-MM-DD'), endDate: v.range[1].format('YYYY-MM-DD'),
        scopeFilter: (v.deptIds?.length || v.empIds?.length) ? { deptIds: v.deptIds || [], empIds: v.empIds || [] } : undefined,
      };
      if (editingTask) {
        await api(`/api/v1/tasks/${editingTask.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        message.success('草稿已更新'); setEditingTask(null);
        setCreateOpen(false); form.resetFields(); load(); return;
      }
      await api('/api/v1/tasks', { method: 'POST', body: JSON.stringify({ ...payload, asDraft: true }) });
      message.success('草稿已保存——在列表中选中后点「发布」即正式启动考核流程');
      setCreateOpen(false); form.resetFields(); load();"""
assert old in s, 'anchor1'
s = s.replace(old, new, 1)

old = """          { title: '状态', dataIndex: 'status', render: (s) => <Tag color={s === 'RUNNING' ? 'processing' : 'success'}>{s === 'RUNNING' ? '进行中' : '已结束'}</Tag> },
          { title: '操作', render: (_, r: any) => <Button size="small" onClick={() => open(r.id)}>详情</Button> },"""
new = """          { title: '状态', dataIndex: 'status', render: (s) => <Tag color={s === 'DRAFT' ? 'default' : s === 'RUNNING' ? 'processing' : 'success'}>{s === 'DRAFT' ? '草稿' : s === 'RUNNING' ? '进行中' : '已结束'}</Tag> },
          { title: '操作', render: (_, r: any) => <Space>
            {r.status === 'DRAFT' ? (<>
              <Button size="small" type="primary" onClick={() => start(r)}>发布</Button>
              <Button size="small" onClick={() => editTask(r)}>编辑</Button>
              <Button size="small" danger onClick={() => removeTask(r)}>删除</Button>
            </>) : <Button size="small" onClick={() => open(r.id)}>详情</Button>}
          </Space> },"""
assert old in s, 'anchor2'
s = s.replace(old, new, 1)

old = "  const statuses = detail ? Object.keys(detail.byStatus || {}) : [];"
new = """  // 发布草稿 → 启动考核流程（生成考核单/待办/填报单）
  const start = async (r: any) => {
    try {
      const res = await api<any>(`/api/v1/tasks/${r.id}/start`, { method: 'POST' });
      message.success(`已发布，生成 ${res.recordCount} 张考核单，员工已收到待办`);
      load();
    } catch (e: any) { message.error(e.message); }
  };
  const editTask = async (r: any) => {
    const d = await api<any>(`/api/v1/tasks/${r.id}`);
    setEditingTask(r);
    setSchemes(await api<any[]>('/api/v1/schemes'));
    form.setFieldsValue({
      schemeId: d.schemeId, name: d.name, period: d.period,
      range: [dayjs(d.startDate), dayjs(d.endDate)],
      deptIds: d.scopeFilter?.deptIds || [], empIds: d.scopeFilter?.empIds || [],
    });
    setCreateOpen(true);
  };
  const removeTask = (r: any) => {
    Modal.confirm({
      title: `删除草稿任务「${r.name}」？`, content: '草稿尚未生成考核单，删除后不可恢复。',
      okButtonProps: { danger: true },
      onOk: async () => { await api(`/api/v1/tasks/${r.id}`, { method: 'DELETE' }); message.success('已删除'); load(); },
    });
  };

  const statuses = detail ? Object.keys(detail.byStatus || {}) : [];"""
assert old in s, 'anchor3'
s = s.replace(old, new, 1)

old = "  const [createOpen, setCreateOpen] = useState(false);"
new = """  const [createOpen, setCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [depts, setDepts] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);"""
assert old in s, 'anchor4'
s = s.replace(old, new, 1)

old = "  useEffect(() => { load(); }, [load]);\n\n  // 发起考核任务"
new = """  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api<any[]>('/api/v1/departments').then(setDepts).catch(() => {});
    api<any>('/api/v1/employees?page_size=100').then((r: any) => setEmps(r.list || r)).catch(() => {});
  }, []);

  // 发起考核任务"""
assert old in s, 'anchor5'
s = s.replace(old, new, 1)

old = '<Modal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} title="发起考核任务" okText="发起">'
new = '<Modal open={createOpen} onCancel={() => { setCreateOpen(false); setEditingTask(null); form.resetFields(); }} onOk={create} title={editingTask ? \'编辑草稿任务\' : \'发起考核任务（保存为草稿）\'} okText={editingTask ? \'保存\' : \'存草稿\'}>'
assert old in s, 'anchor6'
s = s.replace(old, new, 1)

old = """          <Form.Item name="range" label="起止日期" rules={[{ required: true }]}><DatePicker.RangePicker /></Form.Item>
        </Form>"""
new = """          <Form.Item name="range" label="起止日期" rules={[{ required: true }]}><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="deptIds" label="参与部门（与方案范围取交集；不选=方案全部范围）">
            <Select mode="multiple" allowClear options={depts.map((d: any) => ({ value: d.id, label: d.name }))} placeholder="选部门" />
          </Form.Item>
          <Form.Item name="empIds" label="指定参与人员（可跨部门点名）">
            <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={emps.map((e: any) => ({ value: e.id, label: `${e.name}（${e.empNo}）` }))} placeholder="选人员" />
          </Form.Item>
        </Form>"""
assert old in s, 'anchor7'
s = s.replace(old, new, 1)

if "import dayjs from 'dayjs';" not in s:
    s = s.replace("import { api } from '../api';", "import { api } from '../api';\nimport dayjs from 'dayjs';")
io.open(p, 'w', encoding='utf-8').write(s)
print('TaskPage ok')

# ---------- SchemePage：解锁按钮 ----------
p = r'C:\Users\86132\Desktop\智未EHR\zhiwei-ehr\apps\admin-web\src\pages\SchemePage.tsx'
s = io.open(p, encoding='utf-8').read()
old = "  const copy = async (id: number) => { await api(`/api/v1/schemes/${id}/copy`, { method: 'POST' }); message.success('已复制为新草稿'); load(); };"
new = old + """

  const unlock = async (r: any) => {
    try {
      await api(`/api/v1/schemes/${r.id}/unlock`, { method: 'POST' });
      message.success('已解锁为草稿，可编辑或删除');
      load();
    } catch (e: any) { message.error(e.message); }
  };"""
assert old in s, 's1'
s = s.replace(old, new, 1)
old = '          <Button size="small" onClick={() => copy(r.id)}>复制</Button>'
new = """          {r.status === 'LOCKED' && <Button size="small" onClick={() => unlock(r)}>解锁</Button>}
          <Button size="small" onClick={() => copy(r.id)}>复制</Button>"""
assert old in s, 's2'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('SchemePage ok')
