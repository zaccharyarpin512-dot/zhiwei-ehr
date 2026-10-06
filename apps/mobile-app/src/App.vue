<script setup lang="ts">
// APP 骨架：底部 5 Tab（待办/目标/绩效/团队/我的）—— Q3 已确认首屏=待办流
import { ref } from 'vue';
import TodoView from './views/TodoView.vue';

const tabs = [
  { key: 'todo', label: '待办', icon: '✅' },
  { key: 'goal', label: '目标', icon: '🎯' },
  { key: 'perf', label: '绩效', icon: '📈' },
  { key: 'team', label: '团队', icon: '👥' },
  { key: 'me', label: '我的', icon: '👤' },
] as const;
const active = ref('todo');
</script>

<template>
  <div class="app">
    <main>
      <TodoView v-if="active === 'todo'" />
      <div v-else class="placeholder">
        <p>{{ tabs.find((t) => t.key === active)?.label }}模块建设中</p>
        <p class="sub">（Sprint 3-4 接入：OKR 目标 / 绩效报告 / 团队管理 / 个人中心）</p>
      </div>
    </main>
    <nav class="tabbar">
      <button v-for="t in tabs" :key="t.key" :class="{ on: active === t.key }" @click="active = t.key" :data-testid="`tab-${t.key}`">
        <span class="icon">{{ t.icon }}</span>{{ t.label }}
      </button>
    </nav>
  </div>
</template>

<style scoped>
.app { max-width: 480px; margin: 0 auto; min-height: 100vh; background: #f5f6f8; display: flex; flex-direction: column; }
main { flex: 1; }
.tabbar { display: flex; background: #fff; border-top: 1px solid #e5e6eb; position: sticky; bottom: 0; }
.tabbar button { flex: 1; border: none; background: none; padding: 8px 0 12px; font-size: 12px; color: #86909c; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tabbar button.on { color: #FF5844; }
.icon { font-size: 20px; }
.placeholder { text-align: center; color: #4e5969; padding-top: 100px; }
.sub { color: #86909c; font-size: 12px; }
</style>
