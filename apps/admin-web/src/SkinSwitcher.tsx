// 皮肤切换器（FR-M11-006）：四套内置皮肤，localStorage 记忆（原型 v1.2 交互）
const THEMES = [
  { key: '', label: '珊瑚橙（品牌默认）', color: '#FF5844' },
  { key: 'sky', label: '天空蓝', color: '#2E7FC2' },
  { key: 'sun', label: '暖阳金', color: '#E8920C' },
  { key: 'sage', label: '鼠尾草绿', color: '#5E8A6B' },
];
export const THEME_STORAGE_KEY = 'zw-theme';

export function applyTheme(key: string) {
  if (key) document.documentElement.setAttribute('data-theme', key);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_STORAGE_KEY, key); } catch { /* 隐私模式忽略 */ }
}

export function initTheme() {
  let saved = '';
  try { saved = localStorage.getItem(THEME_STORAGE_KEY) || ''; } catch { /* 忽略 */ }
  applyTheme(saved);
  return saved;
}

export default function SkinSwitcher({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  return (
    <span className="zw-skins" role="radiogroup" aria-label="主题皮肤" style={{ display: 'inline-flex', gap: 7, alignItems: 'center', background: '#f2f3f5', borderRadius: 14, padding: '4px 10px' }}>
      <span style={{ fontSize: 12, color: 'var(--txt3)' }}>皮肤</span>
      {THEMES.map((t) => (
        <button
          key={t.key || 'coral'}
          type="button"
          role="radio"
          aria-checked={value === t.key}
          title={t.label}
          data-theme-key={t.key}
          onClick={() => { applyTheme(t.key); onChange(t.key); }}
          style={{
            width: 18, height: 18, borderRadius: '50%', cursor: 'pointer',
            background: t.color, border: '2px solid #fff',
            boxShadow: value === t.key ? '0 0 0 2px var(--txt)' : '0 0 0 1px var(--line)',
            transform: value === t.key ? 'scale(1.2)' : 'none',
          }}
        />
      ))}
    </span>
  );
}
