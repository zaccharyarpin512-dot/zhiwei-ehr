// Ant Design 5 在 jsdom 下运行所需的浏览器 API 垫片
import '@testing-library/jest-dom/vitest';

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query,
      onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
class RO {
  observe() {} unobserve() {} disconnect() {}
}
if (!(window as any).ResizeObserver) (window as any).ResizeObserver = RO;
if (!('getComputedStyle' in window)) {
  (window as any).getComputedStyle = (el: Element) => ({ getPropertyValue: () => '' } as any);
}
