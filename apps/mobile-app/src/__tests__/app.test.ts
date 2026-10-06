// WP-17/18 APP 端测试（Vue3 H5：5 Tab 骨架 + 待办流 + 自评页布局）
import { mount } from '@vue/test-utils';
import { flushPromises } from '@vue/test-utils';
import App from '../App.vue';
import SelfReviewView from '../views/SelfReviewView.vue';

function mockFetch(routes: Record<string, any>) {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const hit = routes[url];
    return new Response(JSON.stringify(hit ?? null), { status: hit === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

describe('WP-17 APP 骨架（A-01 首屏=待办流，Q3 决策）', () => {
  it('底部 5 Tab 渲染，默认选中待办并加载待办流', async () => {
    mockFetch({ '/api/v1/todos?status=待处理': [{ id: 1, title: 'Q3考核：处理「目标制定」节点', actionUrl: '/records/1' }] });
    const w = mount(App);
    for (const t of ['todo', 'goal', 'perf', 'team', 'me']) {
      expect(w.get(`[data-testid="tab-${t}"]`).exists()).toBe(true);
    }
    expect(w.get('[data-testid="tab-todo"].on').exists()).toBe(true);
    await flushPromises();
    expect(w.get('[data-testid="todo-1"]').text()).toContain('目标制定');
    expect(w.get('[data-testid="todo-1"]').text()).toContain('去处理');
  });

  it('切换 Tab 显示对应占位模块', async () => {
    mockFetch({ '/api/v1/todos?status=待处理': [] });
    const w = mount(App);
    await flushPromises();
    await w.get('[data-testid="tab-perf"]').trigger('click');
    expect(w.text()).toContain('绩效报告');
    expect(w.get('[data-testid="tab-perf"].on').exists()).toBe(true);
  });
});

describe('WP-18 自评页（A-06，Q4 决策：客观只读置顶 + 主观打分在下）', () => {
  const record = {
    taskName: 'Q3考核',
    indicators: [
      { indicatorId: 1, indicatorName: '季度回款额', scoreSource: 'data_fill', targetValue: 500, actualValue: 480, weightedScore: 57.6, weight: 60 },
      { indicatorId: 2, indicatorName: '团队协作', scoreSource: 'review', weight: 40 },
    ],
  };

  it('客观指标只读区置顶展示目标/完成/得分 + 异议入口', () => {
    const w = mount(SelfReviewView, { props: { record } });
    const obj = w.get('[data-testid="objective-readonly"]');
    expect(w.findAll('section')[0].attributes('data-testid')).toBe('objective-readonly');
    expect(obj.text()).toContain('季度回款额');
    expect(obj.text()).toContain('得分 57.6');
    expect(obj.text()).toContain('对数据有异议');
    // 只读区没有打分按钮
    expect(obj.find('.quick').exists()).toBe(false);
  });

  it('填报未完成时客观分显示 🔒 防倒推占位（scoreMasked）', () => {
    const masked = { ...record, indicators: [{ ...record.indicators[0], scoreMasked: true, actualValue: null, weightedScore: null }, record.indicators[1]] };
    const w = mount(SelfReviewView, { props: { record: masked } });
    expect(w.get('[data-testid="objective-readonly"]').text()).toContain('🔒 填报中，完成后可见');
    expect(w.get('[data-testid="objective-readonly"]').text()).not.toContain('得分 57.6');
  });

  it('主观指标快捷打分 + 提交 payload 只含主观项（客观分服务端拦截 40305 的客户端配合）', async () => {
    const w = mount(SelfReviewView, { props: { record } });
    const buttons = w.findAll('.quick button');
    await buttons[3].trigger('click'); // 90 分
    expect((w.vm as any).scores['2'].score).toBe(90);
    await w.get('.submit').trigger('click');
    const events = w.emitted('submit');
    expect(events).toBeTruthy();
    const payload = (events as any)[0][0];
    expect(payload.scores.length).toBe(1);
    expect(payload.scores[0].indicatorId).toBe(2);
    expect(payload.scores[0].score).toBe(90);
  });

  it('未打全部分时阻止提交', async () => {
    const w = mount(SelfReviewView, { props: { record } });
    await w.get('.submit').trigger('click');
    expect(w.emitted('submit')).toBeFalsy();
  });
});
