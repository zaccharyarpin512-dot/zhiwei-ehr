# -*- coding: utf-8 -*-
# WP-14：数据填报三表 + 集合更新 + 登录令牌携带 empId + 测试清理
import io

SCHEMA_ADD = '''
// ---------- 指标数据填报（FR-M05-008，v1.1/v1.2）----------
enum FillOrderStatus {
  PENDING
  SUBMITTED
  RETURNED
  SETTLED
}

enum ObjectionStatus {
  PENDING
  KEPT
  FIXED
}

model DataFillOrder {
  id             BigInt   @id @default(autoincrement())
  tenantId       BigInt   @map("tenant_id")
  taskId         BigInt   @map("task_id")
  dataOwnerDeptId BigInt  @map("data_owner_dept_id")
  fillerEmpId    BigInt?  @map("filler_emp_id")
  status         FillOrderStatus @default(PENDING)
  totalRows      Int      @map("total_rows")
  filledRows     Int      @default(0) @map("filled_rows")
  submittedAt    DateTime? @map("submitted_at")
  returnReason   String?  @map("return_reason")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  items          DataFillItem[]
  @@map("data_fill_order")
}

model DataFillItem {
  id               BigInt   @id @default(autoincrement())
  tenantId         BigInt   @map("tenant_id")
  orderId          BigInt   @map("order_id")
  recordId         BigInt   @map("record_id")
  indicatorId      BigInt   @map("indicator_id")
  targetValue      Decimal? @map("target_value") @db.Decimal(18, 4)
  actualValue      Decimal? @map("actual_value") @db.Decimal(18, 4)
  statScope        String   @map("stat_scope")
  statWindowStart  DateTime? @map("stat_window_start")
  statWindowEnd    DateTime? @map("stat_window_end")
  evidenceNote     String?  @map("evidence_note")
  evidenceFileUrl  String?  @map("evidence_file_url")
  autoScore        Decimal? @map("auto_score") @db.Decimal(8, 2)
  scoreSource      String?  @map("score_source")
  settled          Boolean  @default(false)
  defaultApplied   Boolean  @default(false) @map("default_applied")
  filledAt         DateTime? @map("filled_at")
  filledByEmpId    BigInt?  @map("filled_by_emp_id")
  order            DataFillOrder @relation(fields: [orderId], references: [id])
  @@unique([orderId, recordId, indicatorId])
  @@map("data_fill_item")
}

model IndicatorObjection {
  id             BigInt   @id @default(autoincrement())
  tenantId       BigInt   @map("tenant_id")
  dataFillItemId BigInt   @map("data_fill_item_id")
  recordId       BigInt   @map("record_id")
  raisedByEmpId  BigInt   @map("raised_by_emp_id")
  reason         String
  evidenceFileUrl String? @map("evidence_file_url")
  status         ObjectionStatus @default(PENDING)
  oldValue       Decimal? @map("old_value") @db.Decimal(18, 4)
  newValue       Decimal? @map("new_value") @db.Decimal(18, 4)
  handlerEmpId   BigInt?  @map("handler_emp_id")
  handledAt      DateTime? @map("handled_at")
  createdAt      DateTime @default(now()) @map("created_at")
  @@map("indicator_objection")
}
'''

p = 'prisma/schema.prisma'
s = io.open(p, encoding='utf-8').read()
if 'model DataFillOrder {' not in s:
    s += SCHEMA_ADD
    io.open(p, 'w', encoding='utf-8').write(s)
    print('schema: data fill 3 tables added')
else:
    print('schema already has data fill tables')

p = 'src/prisma.service.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("'AssessmentTask', 'AssessmentRecord', 'RecordIndicator', 'RecordReviewer', 'RecordStatusLog',",
"'AssessmentTask', 'AssessmentRecord', 'RecordIndicator', 'RecordReviewer', 'RecordStatusLog',\n  'DataFillOrder', 'DataFillItem', 'IndicatorObjection',")
s = s.replace("const AUDITED_MODELS = new Set(['Department', 'Employee', 'Indicator', 'IndicatorCategory', 'DeptDataFiller', 'Scheme']);",
"const AUDITED_MODELS = new Set(['Department', 'Employee', 'Indicator', 'IndicatorCategory', 'DeptDataFiller', 'Scheme', 'DataFillItem']);")
io.open(p, 'w', encoding='utf-8').write(s)
print('prisma.service updated')

# 登录令牌携带 empId（防倒推/异议等本人判定需要）
p = 'src/modules/auth/auth.service.ts'
s = io.open(p, encoding='utf-8').read()
old = """  private issue(p: { uid: number; tid: number; roles: string[]; empId?: number }) {"""
assert old in s
# login：查出 employee 绑定
old_login = """    await this.prisma.user.update({ where: { id: user.id }, data: { failedCount: 0, lockedUntil: null } });
    return this.issue({ uid: Number(user.id), tid: Number(user.tenantId), roles: user.roles as string[] });"""
new_login = """    await this.prisma.user.update({ where: { id: user.id }, data: { failedCount: 0, lockedUntil: null } });
    const emp = await this.prisma.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
    return this.issue({ uid: Number(user.id), tid: Number(user.tenantId), roles: user.roles as string[], empId: emp ? Number(emp.id) : undefined });"""
assert old_login in s
s = s.replace(old_login, new_login, 1)
old_sms = """    const user = await this.prisma.user.findFirst({ where: { mobile } });
    if (!user) throw Errors.UNAUTHORIZED();
    return this.issue({ uid: Number(user.id), tid: Number(user.tenantId), roles: user.roles as string[] });"""
new_sms = """    const user = await this.prisma.user.findFirst({ where: { mobile } });
    if (!user) throw Errors.UNAUTHORIZED();
    const emp = await this.prisma.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
    return this.issue({ uid: Number(user.id), tid: Number(user.tenantId), roles: user.roles as string[], empId: emp ? Number(emp.id) : undefined });"""
assert old_sms in s
s = s.replace(old_sms, new_sms, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('auth.service empId in token')

# 测试清理增补
p = 'test/helpers.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("for (const t of ['record_status_log','record_reviewer','record_indicator','assessment_record','assessment_task','scheme_reviewer','scheme_grade_rule','scheme_question','scheme_indicator','scheme_node','scheme']) {",
"for (const t of ['indicator_objection','data_fill_item','data_fill_order','record_status_log','record_reviewer','record_indicator','assessment_record','assessment_task','scheme_reviewer','scheme_grade_rule','scheme_question','scheme_indicator','scheme_node','scheme']) {")
io.open(p, 'w', encoding='utf-8').write(s)
print('helpers updated')
