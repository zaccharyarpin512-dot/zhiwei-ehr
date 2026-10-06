# -*- coding: utf-8 -*-
# WP-16：考核单加目标/自评字段；advance 端点收紧为 HR 专属（员工推进只能走提交动作）
import io

p = 'prisma/schema.prisma'
s = io.open(p, encoding='utf-8').read()
old = """  status         RecordStatus @default(goal_setting)
  finalScore     Decimal?     @map("final_score") @db.Decimal(8, 2)"""
new = """  status         RecordStatus @default(goal_setting)
  goalSubmittedAt DateTime?   @map("goal_submitted_at")
  selfSummary    String?      @map("self_summary")
  selfSubmittedAt DateTime?   @map("self_submitted_at")
  finalScore     Decimal?     @map("final_score") @db.Decimal(8, 2)"""
assert old in s
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('record fields added')

p = 'src/modules/task/task.controller.ts'
s = io.open(p, encoding='utf-8').read()
old = """  // 节点推进（HR 手动推进/超时推进；员工侧提交推进在 WP-16 细化）
  @Post('records/:id/advance')
  advance(@Param('id', ParseIntPipe) id: number, @Body() body: { toStatus: string; note?: string }) {
    return this.svc.advance(id, body.toStatus, body.note);
  }"""
new = """  // 节点推进（HR 手动推进/超时推进专用；员工侧一律走提交动作触发，防自我放行）
  @Post('records/:id/advance')
  @Roles('hr_admin')
  advance(@Param('id', ParseIntPipe) id: number, @Body() body: { toStatus: string; note?: string }) {
    return this.svc.advance(id, body.toStatus, body.note);
  }"""
assert old in s
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('advance restricted to hr_admin')
