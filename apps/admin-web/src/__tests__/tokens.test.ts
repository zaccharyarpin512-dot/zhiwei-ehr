// FR-M11-006 硬约束测试：语义色不参与换肤 + 四套皮肤令牌齐全（对应 AC3 的可读性/一致性走查自动化）
import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(resolve(__dirname, '../tokens.css'), 'utf-8');

function blockOf(selector: string): string {
  const m = css.match(new RegExp(`${selector.replace('[', '\\[').replace(']', '\\]')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}
const varOf = (block: string, name: string) => {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

describe('设计令牌（tokens.css）', () => {
  it(':root 定义全套令牌与四个语义色', () => {
    const root = blockOf(':root');
    for (const v of ['pri', 'pri-d', 'pri-l', 'pri-ring', 'pri-xl', 'pri-xxl', 'pri-g', 'pri-a']) {
      expect(varOf(root, v)).toBeTruthy();
    }
    for (const s of ['red', 'orange', 'green', 'gold']) {
      expect(varOf(root, s)).toBeTruthy();
    }
  });

  it('四套皮肤均定义完整 --pri 族变量', () => {
    for (const th of ['sky', 'sun', 'sage']) {
      const b = blockOf(`[data-theme="${th}"]`);
      for (const v of ['pri', 'pri-d', 'pri-l', 'pri-ring', 'pri-xl', 'pri-xxl', 'pri-g', 'pri-a']) {
        expect(varOf(b, v)).toBeTruthy();
      }
    }
  });

  it('语义色全局一致：任何皮肤块都不得覆盖语义色（逾期红等不随皮肤变化）', () => {
    for (const th of ['sky', 'sun', 'sage']) {
      const b = blockOf(`[data-theme="${th}"]`);
      for (const s of ['red', 'orange', 'green']) {
        expect(varOf(b, s)).toBeNull();
      }
    }
  });

  it('默认皮肤主色为品牌珊瑚橙 #FF5844（Q1 决策）', () => {
    expect(varOf(blockOf(':root'), 'pri')).toBe('#FF5844');
  });
});
