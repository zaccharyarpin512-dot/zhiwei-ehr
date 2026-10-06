import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchemePage from '../pages/SchemePage';
import DataFillPage from '../pages/DataFillPage';
import TaskPage from '../pages/TaskPage';
import ReportPage from '../pages/ReportPage';

const mockFetch = (routes: Record<string, any>) => {
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method || 'GET';
    const key = `${method} ${url}`;
    const hit = routes[key] ?? routes[url];
    const body = typeof hit === 'function' ? await hit(init) : hit;
    return new Response(JSON.stringify(body ?? null), { status: hit === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
  }));
};

describe('WP-12 方案向导页', () => {
  it('指标选项带客观 🔒 标识，权重合计实时提示（AC2/AC4）', async () => {
    mockFetch({
      '/api/v1/schemes': [],
      '/api/v1/indicators?include_disabled=false': [
        { id: 1, name: '季度回款额', sourceType: 'dept_report' },
        { id: 2, name: '团队协作', sourceType: 'manager_review' },
      ],
    });
    render(<SchemePage />);
    fireEvent.click(await screen.findByText('新建方案'));
    expect(screen.getByText('基本信息')).toBeInTheDocument();
    expect(screen.getByText('计分与等级')).toBeInTheDocument();
    fireEvent.click(screen.getByText('下一步'));
    fireEvent.click(screen.getByText('+ 添加指标'));
    const combobox = screen.getAllByRole('combobox').pop()!;
    fireEvent.mouseDown(combobox);
    // 客观指标带 🔒 标识（AC4）——下拉渲染在 portal 中
    await waitFor(() => {
      const found = Array.from(document.querySelectorAll('.ant-select-item-option-content'))
        .some((el) => el.textContent?.includes('季度回款额') && el.textContent?.includes('🔒'));
      expect(found).toBe(true);
    });
    fireEvent.click(screen.getAllByText(/季度回款额/).pop()!);
    // 权重合计实时显示（AC2）
    const spin = screen.getAllByRole('spinbutton').pop()!;
    fireEvent.change(spin, { target: { value: '60' } });
    const sum = screen.getByTestId('weight-sum');
    await waitFor(() => expect(sum.textContent).toContain('60.0%'));
    expect(sum.textContent).toContain('必须为 100%');
  });
});

describe('WP-15 数据填报工作台', () => {
  it('展示填报单列表与口径窗口快照', async () => {
    mockFetch({
      '/api/v1/data-fill-orders': [
        { id: 1, taskName: 'Q3考核', deptName: '财务部', fillerName: '赵填报', filledRows: 0, totalRows: 2, status: 'PENDING' },
      ],
      'GET /api/v1/data-fill-orders/1': {
        id: 1, status: 'PENDING',
        items: [
          { id: 11, recordId: 5, indicatorId: 1, employeeName: '张三', indicatorName: '季度回款额', targetValue: 500, statScope: 'current', windowLabel: '取数范围 2026-07-01 ~ 2026-09-30', hasObjection: false },
        ],
      },
    });
    render(<DataFillPage />);
    expect(await screen.findByText('财务部')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /填\s*报/ }));
    expect(await screen.findByText(/取数范围 2026-07-01 ~ 2026-09-30/)).toBeInTheDocument();
    expect(screen.getByText('整单提交并计分')).toBeInTheDocument();
  });
});

describe('WP-19 任务列表与详情', () => {
  it('展示节点漏斗与人员明细', async () => {
    mockFetch({
      '/api/v1/tasks': [{ id: 1, name: 'Q3考核', period: '2026Q3', startDate: '2026-07-01', endDate: '2026-09-30', status: 'RUNNING', byStatus: { self_review: 2, archived: 8 } }],
      'GET /api/v1/tasks/1': { id: 1, name: 'Q3考核', period: '2026Q3', status: 'RUNNING', byStatus: { self_review: 2, archived: 8 } },
      'GET /api/v1/tasks/1/records': [
        { id: 10, employeeName: '张三', status: 'self_review', finalScore: null, isProvisional: false },
        { id: 11, employeeName: '李四', status: 'archived', finalScore: 92.5, isProvisional: false },
      ],
    });
    render(<TaskPage />);
    expect(await screen.findByText('Q3考核')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /详\s*情/ }));
    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByText('92.5')).toBeInTheDocument();
    expect(screen.getByText('发布结果（存在未结异议将被拦截 40018）')).toBeInTheDocument();
  });
});

describe('WP-25 报表中心页（W-13）', () => {
  it('三个报表 Tab 渲染：进度看板/等级分布/部门对比', async () => {
    mockFetch({
      '/api/v1/tasks': [{ id: 1, name: 'Q3考核', period: '2026Q3' }],
      'GET /api/v1/tasks/1/report/progress': { total: 4, byStatus: { result_confirm: 4 }, unfinished: [{ recordId: 1, employeeName: '李四', status: 'result_confirm' }] },
      'GET /api/v1/tasks/1/report/distribution?by=grade': { by: 'grade', distribution: { A: 2, B: 2 } },
      'GET /api/v1/tasks/1/report/distribution?by=dept': { by: 'dept', cross: { '销售一部': { A: 2 }, '销售二部': { B: 2 } } },
    });
    render(<ReportPage />);
    expect(await screen.findByText('总人数')).toBeInTheDocument();
    expect(screen.getByText('未完成名单（催办数据源）')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('等级分布')).toBeInTheDocument();
    expect(screen.getByText('部门对比')).toBeInTheDocument();
  });
});
