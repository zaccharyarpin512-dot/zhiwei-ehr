<script setup lang="ts">
// A-01 待办流首页：员工打开 APP 第一屏（Q3 已确认决策）
import { onMounted, ref } from 'vue';
import { api } from '../api';

const todos = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    todos.value = await api<any[]>('/api/v1/todos?status=待处理');
  } catch (e: any) { error.value = e.message; }
  loading.value = false;
});

async function done(t: any) {
  await api(`/api/v1/todos/${t.id}/done`, { method: 'POST' });
  todos.value = todos.value.filter((x) => x.id !== t.id);
}
</script>

<template>
  <div class="todo-view">
    <h2>待办</h2>
    <p v-if="loading">加载中…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="todos.length === 0" class="empty">🎉 全部处理完毕</p>
    <div v-else class="card" v-for="t in todos" :key="t.id" :data-testid="`todo-${t.id}`">
      <div class="title">{{ t.title }}</div>
      <div class="actions">
        <a :href="t.actionUrl" class="go">去处理 →</a>
        <button class="done" @click="done(t)">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-view { padding: 16px; }
.card { background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.title { font-size: 15px; font-weight: 600; }
.actions { display: flex; justify-content: space-between; margin-top: 10px; }
.go { color: #FF5844; text-decoration: none; font-size: 14px; }
.done { border: none; background: #FDEAE5; color: #FF5844; border-radius: 16px; padding: 4px 14px; }
.empty { text-align: center; color: #86909c; margin-top: 60px; }
.error { color: #f53f3f; }
</style>
