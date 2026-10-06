<script setup lang="ts">
// A-06 自评页核心布局（Q4 已确认）：客观指标只读区置顶 + 主观打分在下，不合并成表
import { computed, ref } from 'vue';

const props = defineProps<{ record: any }>();
const emit = defineEmits(['submit']);

// 客观指标（score_source=data_fill 或 auto_system）：只读回顾，附异议入口
const objective = computed(() => (props.record?.indicators || []).filter((i: any) => i.scoreSource === 'data_fill'));
const subjective = computed(() => (props.record?.indicators || []).filter((i: any) => i.scoreSource !== 'data_fill'));
const scores = ref<Record<string, { score: number | null; comment: string }>>({});
const summary = ref('');

function scoreOf(id: string) { return scores.value[id]?.score ?? null; }
function commentOf(id: string) { return scores.value[id]?.comment || ''; }
function setScore(id: string, v: number) { scores.value = { ...scores.value, [id]: { score: v, comment: commentOf(id) } }; }
function setComment(id: string, e: Event) { scores.value = { ...scores.value, [id]: { score: scoreOf(id), comment: (e.target as HTMLTextAreaElement).value } }; }

function submit() {
  const items = subjective.value.map((i: any) => ({ indicatorId: i.indicatorId, score: scoreOf(String(i.indicatorId)), comment: scores.value[String(i.indicatorId)]?.comment }));
  if (items.some((i: any) => i.score === null)) return alert('请为所有主观指标打分');
  emit('submit', { scores: items, summary: summary.value });
}
</script>

<template>
  <div class="self-review" v-if="record">
    <h2>自评 · {{ record.taskName || '' }}</h2>

    <!-- 客观指标只读区（置顶，Q4 决策） -->
    <section class="objective" data-testid="objective-readonly">
      <h3>📊 客观指标完成情况（由出数部门填报，系统计分）</h3>
      <div v-for="i in objective" :key="i.indicatorId" class="row">
        <div class="name">{{ i.indicatorName }}</div>
        <div class="vals">
          <span>目标 {{ i.targetValue }}</span>
          <span v-if="!i.scoreMasked">完成 {{ i.actualValue }}</span>
          <span v-if="!i.scoreMasked" class="score">得分 {{ i.weightedScore }}</span>
          <span v-else class="masked">🔒 填报中，完成后可见</span>
        </div>
        <button v-if="!i.scoreMasked" class="objection">对数据有异议？</button>
      </div>
      <p v-if="objective.length === 0" class="empty">本方案无客观指标</p>
    </section>

    <!-- 主观指标打分区（在下） -->
    <section class="subjective">
      <h3>✍️ 主观指标自评</h3>
      <div v-for="i in subjective" :key="i.indicatorId" class="card">
        <div class="name">{{ i.indicatorName }} <span class="weight">权重 {{ i.weight }}%</span></div>
        <div class="quick">
          <button v-for="s in [60, 70, 80, 90, 100]" :key="s"
            :class="{ on: scoreOf(String(i.indicatorId)) === s }" @click="setScore(String(i.indicatorId), s)">{{ s }}</button>
        </div>
        <textarea placeholder="自评说明（可选）" :value="commentOf(String(i.indicatorId))" @input="setComment(String(i.indicatorId), $event)" />
      </div>
      <p v-if="subjective.length === 0" class="empty">本方案无主观指标</p>
    </section>

    <textarea class="summary" placeholder="本期总结（必填项由方案配置决定）" v-model="summary" />
    <button class="submit" @click="submit">提交自评（提交后锁定）</button>
  </div>
</template>

<style scoped>
.self-review { padding: 16px; }
.objective { background: #FDF5F2; border-radius: 12px; padding: 14px; margin-bottom: 16px; }
h3 { font-size: 14px; margin-bottom: 10px; }
.row { background: #fff; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.name { font-weight: 600; font-size: 14px; }
.weight { color: #86909c; font-weight: 400; font-size: 12px; }
.vals { display: flex; gap: 12px; color: #4e5969; font-size: 13px; margin: 6px 0; }
.score { color: #FF5844; font-weight: 700; }
.masked { color: #86909c; }
.objection { border: none; background: none; color: #2E7FC2; font-size: 12px; padding: 0; }
.card { background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.quick { display: flex; gap: 8px; margin: 10px 0; }
.quick button { flex: 1; border: 1px solid #e5e6eb; background: #fff; border-radius: 8px; padding: 8px 0; }
.quick button.on { background: #FF5844; color: #fff; border-color: #FF5844; }
textarea { width: 100%; border: 1px solid #e5e6eb; border-radius: 8px; padding: 8px; box-sizing: border-box; }
.summary { margin: 8px 0 16px; min-height: 70px; }
.submit { width: 100%; border: none; background: #FF5844; color: #fff; border-radius: 22px; padding: 12px; font-size: 15px; }
.empty { color: #86909c; font-size: 13px; }
</style>
