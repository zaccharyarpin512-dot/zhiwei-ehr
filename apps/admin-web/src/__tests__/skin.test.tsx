// FR-M11-006 验收测试：皮肤切换器行为（对应 UAT 13 的皮肤切换链路）
import { render, screen, fireEvent } from '@testing-library/react';
import SkinSwitcher, { applyTheme, THEME_STORAGE_KEY } from '../SkinSwitcher';

describe('主题皮肤切换器（FR-M11-006）', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('渲染四个皮肤选项（珊瑚橙默认/天空蓝/暖阳金/鼠尾草绿）', () => {
    render(<SkinSwitcher value="" onChange={() => {}} />);
    expect(screen.getByTitle('珊瑚橙（品牌默认）')).toBeInTheDocument();
    expect(screen.getByTitle('天空蓝')).toBeInTheDocument();
    expect(screen.getByTitle('暖阳金')).toBeInTheDocument();
    expect(screen.getByTitle('鼠尾草绿')).toBeInTheDocument();
  });

  it('点击天空蓝 → html 设置 data-theme="sky" 并写入 localStorage', () => {
    render(<SkinSwitcher value="" onChange={() => {}} />);
    fireEvent.click(screen.getByTitle('天空蓝'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('sky');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('sky');
  });

  it('切回珊瑚橙（默认）→ 移除 data-theme（走 :root 默认令牌）', () => {
    applyTheme('sage');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sage');
    render(<SkinSwitcher value="sage" onChange={() => {}} />);
    fireEvent.click(screen.getByTitle('珊瑚橙（品牌默认）'));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('');
  });

  it('当前皮肤有选中态（aria-checked）', () => {
    render(<SkinSwitcher value="sun" onChange={() => {}} />);
    expect(screen.getByTitle('暖阳金')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTitle('天空蓝')).toHaveAttribute('aria-checked', 'false');
  });
});
