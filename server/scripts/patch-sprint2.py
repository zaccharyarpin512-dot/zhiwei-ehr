# -*- coding: utf-8 -*-
# Sprint 2 schema 扩展 + 租户/审计模型集合更新
import io

SCHEMA_ADD = '''
// ---------- M03 绩效方案（FR-M03-001/002/003/005）----------
enum SchemeMode {
  kpi
  okr
  kpi_okr
  e360 // PRD 值 "360"
  kpi_360
}

enum SchemeStatus {
  DRAFT
  LOCKED
  DISABLED
}

enum PeriodType {
  month
  quarter
  half_year
  year
}

enum ReviewerType {
  self
  manager
  manager_up
  peer
  subordinate
}

enum NodeType {
  goal_setting
  goal_approval
  data_fill
  self_review
  peer_review
  manager_review
  calibrating
  result_confirm
  appealing
  interviewing
  archived
}

model Scheme {
  id               BigInt   @id @default(autoincrement())
  tenantId         BigInt   @map("tenant_id")
  name             String
  mode             SchemeMode
  periodType       PeriodType @map("period_type")
  scopeFilter      Json?    @map("scope_filter")
  linkageConfig    Json?    @map("linkage_config")
  taskCreditConfig Json?    @map("task_credit_config")
  status           SchemeStatus @default(DRAFT)
  version          Int      @default(1)
  isDeleted        Boolean  @default(false) @map("is_deleted")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  nodes            SchemeNode[]
  indicators       SchemeIndicator[]
  questions        SchemeQuestion[]
  gradeRules       SchemeGradeRule[]
  reviewers        SchemeReviewer[]
  tasks            AssessmentTask[]
  @@map("scheme")
}

model SchemeNode {
  id         BigInt   @id @default(autoincrement())
  tenantId   BigInt   @map("tenant_id")
  schemeId   BigInt   @map("scheme_id")
  nodeType   NodeType @map("node_type")
  seq        Int
  timeConfig Json?    @map("time_config")
  enabled    Boolean  @default(true)
  scheme     Scheme   @relation(fields: [schemeId], references: [id])
  @@map("scheme_node")
}

model SchemeIndicator {
  id           BigInt   @id @default(autoincrement())
  tenantId     BigInt   @map("tenant_id")
  schemeId     BigInt   @map("scheme_id")
  indicatorId  BigInt   @map("indicator_id")
  weight       Decimal  @db.Decimal(5, 2)
  defaultTarget Decimal? @map("default_target") @db.Decimal(18, 4)
  scheme       Scheme   @relation(fields: [schemeId], references: [id])
  @@map("scheme_indicator")
}

model SchemeQuestion {
  id        BigInt   @id @default(autoincrement())
  tenantId  BigInt   @map("tenant_id")
  schemeId  BigInt   @map("scheme_id")
  title     String
  qType     String   @map("q_type")
  options   Json?
  required  Boolean  @default(true)
  scheme    Scheme   @relation(fields: [schemeId], references: [id])
  @@map("scheme_question")
}

model SchemeGradeRule {
  id         BigInt   @id @default(autoincrement())
  tenantId   BigInt   @map("tenant_id")
  schemeId   BigInt   @map("scheme_id")
  grade      String
  minScore   Decimal  @map("min_score") @db.Decimal(6, 2)
  maxScore   Decimal  @map("max_score") @db.Decimal(6, 2)
  ratioLimit Decimal? @map("ratio_limit") @db.Decimal(5, 2)
  sortNo     Int      @map("sort_no")
  scheme     Scheme   @relation(fields: [schemeId], references: [id])
  @@map("scheme_grade_rule")
}

model SchemeReviewer {
  id           BigInt       @id @default(autoincrement())
  tenantId     BigInt       @map("tenant_id")
  schemeId     BigInt       @map("scheme_id")
  reviewerType ReviewerType @map("reviewer_type")
  weight       Decimal      @db.Decimal(5, 2)
  config       Json?
  scheme       Scheme       @relation(fields: [schemeId], references: [id])
  @@map("scheme_reviewer")
}

// ---------- M05 考核任务与考核单（FR-M05-001，PRD 7.1/7.2 状态机）----------
enum TaskStatus {
  RUNNING
  FINISHED
  TERMINATED
}

enum RecordStatus {
  goal_setting
  goal_approval
  data_fill
  self_review
  peer_review
  manager_review
  calibrating
  result_confirm
  appealing
  interviewing
  archived
}

model AssessmentTask {
  id            BigInt     @id @default(autoincrement())
  tenantId      BigInt     @map("tenant_id")
  schemeId      BigInt     @map("scheme_id")
  schemeVersion Int        @map("scheme_version")
  name          String
  period        String
  startDate     DateTime   @map("start_date")
  endDate       DateTime   @map("end_date")
  status        TaskStatus @default(RUNNING)
  orgSnapshot   Json?      @map("org_snapshot")
  linkedTaskIds Json?      @map("linked_task_ids")
  isDeleted     Boolean    @default(false) @map("is_deleted")
  createdAt     DateTime   @default(now()) @map("created_at")
  scheme        Scheme     @relation(fields: [schemeId], references: [id])
  records       AssessmentRecord[]
  @@map("assessment_task")
}

model AssessmentRecord {
  id             BigInt       @id @default(autoincrement())
  tenantId       BigInt       @map("tenant_id")
  taskId         BigInt       @map("task_id")
  empId          BigInt       @map("emp_id")
  deptSnapshotId BigInt?      @map("dept_snapshot_id")
  managerEmpId   BigInt?      @map("manager_emp_id")
  status         RecordStatus @default(goal_setting)
  finalScore     Decimal?     @map("final_score") @db.Decimal(8, 2)
  isProvisional  Boolean      @default(false) @map("is_provisional")
  grade          String?
  publishTime    DateTime?    @map("publish_time")
  rollupDetail   Json?        @map("rollup_detail")
  task           AssessmentTask @relation(fields: [taskId], references: [id])
  indicators     RecordIndicator[]
  reviewers      RecordReviewer[]
  statusLogs     RecordStatusLog[]
  @@unique([taskId, empId])
  @@map("assessment_record")
}

model RecordIndicator {
  id             BigInt   @id @default(autoincrement())
  tenantId       BigInt   @map("tenant_id")
  recordId       BigInt   @map("record_id")
  indicatorId    BigInt   @map("indicator_id")
  targetValue    Decimal? @map("target_value") @db.Decimal(18, 4)
  selfScore      Decimal? @map("self_score") @db.Decimal(8, 2)
  selfComment    String?  @map("self_comment")
  managerScore   Decimal? @map("manager_score") @db.Decimal(8, 2)
  managerComment String?  @map("manager_comment")
  weightedScore  Decimal? @map("weighted_score") @db.Decimal(8, 2)
  scoreSource    String?  @map("score_source")
  dataFillItemId BigInt?  @map("data_fill_item_id")
  record         AssessmentRecord @relation(fields: [recordId], references: [id])
  @@map("record_indicator")
}

model RecordReviewer {
  id              BigInt   @id @default(autoincrement())
  tenantId        BigInt   @map("tenant_id")
  recordId        BigInt   @map("record_id")
  reviewerEmpId   BigInt   @map("reviewer_emp_id")
  reviewerType    String   @map("reviewer_type")
  status          String   @default("待评")
  relationScore   Decimal? @map("relation_score") @db.Decimal(8, 2)
  relationComment String?  @map("relation_comment")
  submittedAt     DateTime? @map("submitted_at")
  record          AssessmentRecord @relation(fields: [recordId], references: [id])
  @@map("record_reviewer")
}

model RecordStatusLog {
  id             BigInt   @id @default(autoincrement())
  tenantId       BigInt   @map("tenant_id")
  recordId       BigInt   @map("record_id")
  fromStatus     String   @map("from_status")
  toStatus       String   @map("to_status")
  operatorEmpId  BigInt?  @map("operator_emp_id")
  note           String?
  createdAt      DateTime @default(now()) @map("created_at")
  record         AssessmentRecord @relation(fields: [recordId], references: [id])
  @@map("record_status_log")
}
'''

p = 'prisma/schema.prisma'
s = io.open(p, encoding='utf-8').read()
if 'model Scheme {' not in s:
    s += SCHEMA_ADD
    io.open(p, 'w', encoding='utf-8').write(s)
    print('schema extended')
else:
    print('schema already extended')

p = 'src/prisma.service.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("""const TENANT_MODELS = new Set([
  'Department', 'Employee', 'EmployeeTransferLog',
  'IndicatorCategory', 'Indicator', 'DeptDataFiller',
  'Todo', 'Message',
]);""",
"""const TENANT_MODELS = new Set([
  'Department', 'Employee', 'EmployeeTransferLog',
  'IndicatorCategory', 'Indicator', 'DeptDataFiller',
  'Todo', 'Message', 'AuditLog',
  'Scheme', 'SchemeNode', 'SchemeIndicator', 'SchemeQuestion', 'SchemeGradeRule', 'SchemeReviewer',
  'AssessmentTask', 'AssessmentRecord', 'RecordIndicator', 'RecordReviewer', 'RecordStatusLog',
]);""")
s = s.replace("const AUDITED_MODELS = new Set(['Department', 'Employee', 'Indicator', 'IndicatorCategory', 'DeptDataFiller']);",
"const AUDITED_MODELS = new Set(['Department', 'Employee', 'Indicator', 'IndicatorCategory', 'DeptDataFiller', 'Scheme']);")
io.open(p, 'w', encoding='utf-8').write(s)
print('extension updated')
