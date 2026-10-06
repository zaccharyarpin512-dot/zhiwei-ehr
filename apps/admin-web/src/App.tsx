import { useState } from 'react';
import { Button, ConfigProvider, Form, Input, Layout, Menu, message, theme as antdTheme } from 'antd';
import {
  DashboardOutlined, TeamOutlined, AimOutlined, ProfileOutlined, ScheduleOutlined,
  DatabaseOutlined, BarChartOutlined, SettingOutlined, LogoutOutlined,
} from '@ant-design/icons';
import SkinSwitcher, { initTheme, applyTheme } from './SkinSwitcher';
import { login, setToken, clearToken, getToken } from './api';
import OrgPage from './pages/OrgPage';
import IndicatorPage from './pages/IndicatorPage';
import SchemePage from './pages/SchemePage';
import TaskPage from './pages/TaskPage';
import DataFillPage from './pages/DataFillPage';
import ReportPage from './pages/ReportPage';
import WorkTaskPage, { Dashboard } from './pages/WorkTaskPage';
import SettingsPage from './pages/SettingsPage';

// 四套皮肤对应的 AntD 主色（与设计令牌保持一致；皮肤切换=换一组变量+antd token）
const ANTD_PRIMARY: Record<string, string> = {
  '': '#FF5844', sky: '#2E7FC2', sun: '#E8920C', sage: '#5E8A6B',
};

const NAV = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '工作台' },
  { key: 'org', icon: <TeamOutlined />, label: '组织架构' },
  { key: 'indicators', icon: <AimOutlined />, label: '指标库' },
  { key: 'schemes', icon: <ProfileOutlined />, label: '绩效方案' },
  { key: 'tasks', icon: <ScheduleOutlined />, label: '考核任务' },
  { key: 'datafill', icon: <DatabaseOutlined />, label: '数据填报' },
  { key: 'worktasks', icon: <ScheduleOutlined />, label: '过程任务' },
  { key: 'reports', icon: <BarChartOutlined />, label: '报表中心' },
  { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
];

function Login({ onOk }: { onOk: () => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, var(--pri-l), var(--pri-xxl))` }}>
      <div style={{ width: 380, background: '#fff', borderRadius: 12, padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--pri)' }}>智未EHR</div>
          <div style={{ color: 'var(--txt3)', marginTop: 6 }}>绩效管理系统 · 管理后台</div>
        </div>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setLoading(true);
            try {
              const r = await login(v.mobile, v.password);
              setToken(r.accessToken);
              message.success('登录成功');
              onOk();
            } catch (e: any) {
              message.error(e.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item name="mobile" label="手机号" rules={[{ required: true, pattern: /^1\d{10}$/, message: '请输入 11 位手机号' }]}>
            <Input size="large" placeholder="138 0000 0000" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password size="large" placeholder="请输入密码" />
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" block loading={loading}>登 录</Button>
        </Form>
      </div>
    </div>
  );
}

function ShellWithSwitcher({ onLogout, themeKey, onThemeChange }: { onLogout: () => void; themeKey: string; onThemeChange: (k: string) => void }) {
  const [nav, setNav] = useState('dashboard');
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="dark" width={200}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 17, padding: '18px 24px' }}>智未EHR</div>
        <Menu theme="dark" mode="inline" selectedKeys={[nav]} items={NAV} onClick={(e) => setNav(e.key)} />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px' }}>
          <b>{NAV.find((n) => n.key === nav)?.label}</b>
          <span style={{ flex: 1 }} />
          <SkinSwitcher value={themeKey} onChange={onThemeChange} />
          <Button icon={<LogoutOutlined />} onClick={onLogout}>退出</Button>
        </Layout.Header>
        <Layout.Content style={{ padding: 24, background: 'var(--bg)' }}>
          {nav === 'dashboard' ? <Dashboard /> : nav === 'org' ? <OrgPage /> : nav === 'indicators' ? <IndicatorPage /> : nav === 'schemes' ? <SchemePage /> : nav === 'tasks' ? <TaskPage /> : nav === 'datafill' ? <DataFillPage /> : nav === 'worktasks' ? <WorkTaskPage /> : nav === 'reports' ? <ReportPage /> : nav === 'settings' ? <SettingsPage /> : (
            <div style={{ background: '#fff', borderRadius: 8, padding: 40, color: 'var(--txt3)' }}>
              「{NAV.find((n) => n.key === nav)?.label}」页面建设中（对应开发计划后续 WP）
            </div>
          )}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [themeKey, setThemeKey] = useState(initTheme());

  const onThemeChange = (k: string) => {
    setThemeKey(k);
    applyTheme(k);
    window.dispatchEvent(new Event('zw-theme-change'));
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: { colorPrimary: ANTD_PRIMARY[themeKey] || ANTD_PRIMARY[''], colorLink: ANTD_PRIMARY[themeKey] || ANTD_PRIMARY[''] },
      }}
    >
      {authed ? (
        <ShellWithSwitcher onLogout={() => { clearToken(); setAuthed(false); }} themeKey={themeKey} onThemeChange={onThemeChange} />
      ) : (
        <Login onOk={() => setAuthed(true)} />
      )}
    </ConfigProvider>
  );
}
