// WP-6/WP-10 页面组件测试（fetch 全部 mock，验证渲染与关键交互点位）
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrgPage from '../pages/OrgPage';
import IndicatorPage from '../pages/IndicatorPage';

const DEPT_TREE = [
  { id: 1, code: 'ROOT', name: '智未科技', children: [{ id: 2, code: 'D1', name: '销售中心', children: [] }] },
];
const EMPS = {
  list: [
    { id: 11, empNo: 'ZW1001', name: '李四', mobile: '13800000001', position: '大客户经理', jobLevel: 'P4', status: 'ACTIVE', departmentId: 2 },
    { id: 12, empNo: 'ZW1002', name: '王五', mobile: '13800000002', position: '销售专员', jobLevel: 'P3', status: 'PROBATION', departmentId: 2 },
  ],
  total: 2, page: 1, page_size: 20,
};
const INDICATORS = [
  { id: 21, name: '季度回款额', statScope: 'ytd', sourceType: 'dept_report', dataOwnerDeptId: 3, unit: '万元', status: 'ENABLED', objectiveBadge: '🔒 客观指标', group: 'objective', scopePreview: '口径：年初至当期累计(YTD)｜取数范围：2026-01-01 ~ 2026-09-30' },
  { id: 22, name: '团队协作', statScope: 'current', sourceType: 'self_report', dataOwnerDeptId: null, unit: null, status: 'ENABLED', objectiveBadge: null, group: 'subjective', scopePreview: '口径：当期值｜取数范围：2026-07-01 ~ 2026-09-30' },
];

function mockFetch(routes: Record<string, any>) {
  const spy = vi.fn(async (url: any) => {
    const key = String(url).split('?')[0];
    const body = routes[key];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ message: 'not mocked: ' + key }) } as any;
    return { ok: true, status: 200, json: async () => body } as any;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('W-03/04 组织与员工页（WP-6）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('渲染部门树与员工列表（在职/试用期状态标签）', async () => {
    mockFetch({ '/api/v1/departments': DEPT_TREE, '/api/v1/employees': EMPS });
    render(<OrgPage />);
    expect(await screen.findByText('销售中心')).toBeInTheDocument();
    expect(await screen.findByText('李四')).toBeInTheDocument();
    expect(await screen.findByText('王五')).toBeInTheDocument();
    expect(await screen.findByText('在职')).toBeInTheDocument();
    expect(await screen.findByText('试用期')).toBeInTheDocument();
  });

  it('提供 Excel 导入入口（FR-M01-002 批量导入）', async () => {
    mockFetch({ '/api/v1/departments': DEPT_TREE, '/api/v1/employees': EMPS });
    render(<OrgPage />);
    expect(await screen.findByText('Excel 导入')).toBeInTheDocument();
  });
});

describe('W-05 指标库页（WP-10）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('客观指标显示 🔒 标识，YTD 口径显示统计窗口预览（AC3/AC4）', async () => {
    mockFetch({ '/api/v1/indicators': INDICATORS, '/api/v1/departments': DEPT_TREE });
    render(<IndicatorPage />);
    expect(await screen.findByText('🔒 客观指标')).toBeInTheDocument();
    expect(await screen.findByText('YTD 累计')).toBeInTheDocument();
    expect(await screen.findByText(/2026-01-01 ~ 2026-09-30/)).toBeInTheDocument();
    // 自报指标无 🔒 标识（同一表格内仅一个 🔒）
    expect(screen.getAllByText('🔒 客观指标')).toHaveLength(1);
  });

  it('新建弹窗展示口径即时预览文案（AC4）', async () => {
    mockFetch({ '/api/v1/indicators': INDICATORS, '/api/v1/departments': DEPT_TREE });
    render(<IndicatorPage />);
    fireEvent.click(await screen.findByText('新建指标'));
    expect(await screen.findByText(/Q3 季度考核 → 取数范围 2026-07-01 至 2026-09-30/)).toBeInTheDocument();
  });
});
