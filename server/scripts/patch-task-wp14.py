# -*- coding: utf-8 -*-
# TaskService 集成：spawnOrders + publish（未结异议拦截）+ getRecord 防倒推屏蔽
import io

p = 'src/modules/task/task.service.ts'
s = io.open(p, encoding='utf-8').read()

s = s.replace("""import { canTransit, initialStatus } from '../../lib/state-machine';""",
"""import { canTransit, initialStatus } from '../../lib/state-machine';
import { DataFillService } from '../datafill/datafill.service';
import { ctx } from '../../tenant-context';""")

s = s.replace("""export class TaskService {
  constructor(private prisma: PrismaService) {}""",
"""export class TaskService {
  constructor(private prisma: PrismaService, private dataFill: DataFillService) {}""")

# 员工查询带 hireDate；指标详情查询
s = s.replace("select: { id: true, empNo: true, name: true, departmentId: true, managerEmpId: true, userId: true, jobLevel: true },",
"select: { id: true, empNo: true, name: true, departmentId: true, managerEmpId: true, userId: true, jobLevel: true, hireDate: true },")

s = s.replace("""    const [nodes, indicators, reviewers] = await Promise.all([
      this.prisma.schemeNode.findMany({ where: { schemeId: scheme.id }, orderBy: { seq: 'asc' } }),
      this.prisma.schemeIndicator.findMany({ where: { schemeId: scheme.id } }),
      this.prisma.schemeReviewer.findMany({ where: { schemeId: scheme.id } }),
    ]);""",
"""    const [nodes, indicators, reviewers] = await Promise.all([
      this.prisma.schemeNode.findMany({ where: { schemeId: scheme.id }, orderBy: { seq: 'asc' } }),
      this.prisma.schemeIndicator.findMany({ where: { schemeId: scheme.id } }),
      this.prisma.schemeReviewer.findMany({ where: { schemeId: scheme.id } }),
    ]);
    // 指标详情（sourceType/scoreRule/口径）——填报拆单与计分用
    const indDetails = await this.prisma.indicator.findMany({
      where: { id: { in: indicators.map((i) => i.indicatorId) } },
    });
    const indPairs = indicators.map((si) => ({ schemeIndicator: si, detail: indDetails.find((d) => d.id === si.indicatorId) }));""")

# records 收集 + spawn
s = s.replace("""      const startStatus = initialStatus(nodes.map((n) => ({ nodeType: n.nodeType, enabled: n.enabled })));
      for (const e of filtered) {""",
"""      const startStatus = initialStatus(nodes.map((n) => ({ nodeType: n.nodeType, enabled: n.enabled })));
      const createdRecords: { id: bigint; empId: bigint; hireDate: Date }[] = [];
      for (const e of filtered) {""")
s = s.replace("""        await tx.recordStatusLog.create({ data: { tenantId: tid, recordId: rec.id, fromStatus: '', toStatus: startStatus, operatorEmpId: null, note: '任务发起' } });""",
"""        await tx.recordStatusLog.create({ data: { tenantId: tid, recordId: rec.id, fromStatus: '', toStatus: startStatus, operatorEmpId: null, note: '任务发起' } });
        createdRecords.push({ id: rec.id, empId: e.id, hireDate: e.hireDate });""")

# spawn 调用（事务内，锁定方案之前）
s = s.replace("""      // FR-M03-002：方案首次被任务引用即锁定
      if (scheme.status === 'DRAFT') await tx.scheme.update({ where: { id: scheme.id }, data: { status: 'LOCKED' } });
      return t;""",
"""      // WP-14：data_fill 节点启用时按出数部门拆分填报工作单（固化口径快照）
      await this.dataFill.spawnOrders(tx, {
        task: { id: t.id, startDate: t.startDate, endDate: t.endDate },
        nodes, records: createdRecords, indicators: indPairs,
      });
      // FR-M03-002：方案首次被任务引用即锁定
      if (scheme.status === 'DRAFT') await tx.scheme.update({ where: { id: scheme.id }, data: { status: 'LOCKED' } });
      return t;""")

# publish（带未结异议拦截）
s = s.replace("""  async getRecord(id: number) {""",
"""  // 发布结果（FR-M06-004）：存在未结异议一律拦截；校准中的考核单进入结果确认
  async publish(id: number) {
    await this.dataFill.assertNoPendingObjections(id);
    const records = await this.prisma.assessmentRecord.findMany({ where: { taskId: id } });
    const notReady = records.filter((r) => r.status !== 'calibrating' && r.status !== 'result_confirm' && r.status !== 'appealing');
    if (notReady.length > 0) {
      throw new BusinessError(40908, `尚有 ${notReady.length} 张考核单未进入校准节点，不能发布`, 409);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const r of records) {
        if (r.status === 'calibrating') {
          await tx.assessmentRecord.update({ where: { id: r.id }, data: { status: 'result_confirm', publishTime: new Date() } });
          await tx.recordStatusLog.create({ data: { tenantId: mustCtx().tenantId, recordId: r.id, fromStatus: 'calibrating', toStatus: 'result_confirm', note: 'HR 发布结果' } });
        }
      }
    });
    return { published: records.length };
  }

  async getRecord(id: number) {""")

# getRecord 防倒推：本人 + 存在未计分客观行 → 屏蔽实际值/得分（AC5）
s = s.replace("""    return { ...rec, id: Number(rec.id), taskId: Number(rec.taskId), indicators, reviewers, logs };
  }
}""",
"""    // AC5 防倒推：填报完成前，被考核人本人任何接口拿不到客观指标完成值/得分
    const c = ctx();
    let masked = indicators;
    if (c?.empId && Number(rec.empId) === c.empId) {
      const objective = indicators.filter((i) => i.scoreSource === 'data_fill' || true);
      const recIndicators = await this.prisma.recordIndicator.findMany({ where: { recordId: id } });
      const hasUnfilled = await this.hasUnfilledObjective(id, recIndicators);
      if (hasUnfilled) {
        const unfilledIds = new Set(
          (await this.unfilledObjectiveItems(id)).map((x) => Number(x.indicatorId)),
        );
        masked = indicators.map((i) =>
          unfilledIds.has(Number(i.indicatorId))
            ? { ...i, actualValue: null, weightedScore: null, scoreMasked: true }
            : i,
        );
        void objective;
      }
    }
    return { ...rec, id: Number(rec.id), taskId: Number(rec.taskId), indicators: masked, reviewers, logs };
  }

  // 是否存在尚未填报计分的客观指标行（防倒推判定）
  private async hasUnfilledObjective(recordId: number, ris: any[]): Promise<boolean> {
    return (await this.unfilledObjectiveItems(recordId, ris)).length > 0;
  }
  private async unfilledObjectiveItems(recordId: number, ris?: any[]): Promise<any[]> {
    const recIndicators = ris || await this.prisma.recordIndicator.findMany({ where: { recordId } });
    const indIds = recIndicators.map((r) => r.indicatorId);
    const inds = await this.prisma.indicator.findMany({ where: { id: { in: indIds } }, select: { id: true, sourceType: true } });
    const objectiveIds = new Set(inds.filter((i) => i.sourceType === 'dept_report' || i.sourceType === 'auto_system').map((i) => Number(i.id)));
    return recIndicators.filter((r) => objectiveIds.has(Number(r.indicatorId)) && r.scoreSource !== 'data_fill');
  }
}""")

io.open(p, 'w', encoding='utf-8').write(s)
print('task.service integrated')

# TaskModule 引入 DataFillModule；TaskController 加 publish；AppModule 注册 DataFillModule
p = 'src/modules/task/task.module.ts'
s = io.open(p, encoding='utf-8').read()
s = """import { Module } from '@nestjs/common';
import { DataFillModule } from '../datafill/datafill.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
@Module({ imports: [DataFillModule], controllers: [TaskController], providers: [TaskService], exports: [TaskService] })
export class TaskModule {}
"""
io.open(p, 'w', encoding='utf-8').write(s)

p = 'src/modules/task/task.controller.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("""  // 节点推进（HR 手动推进/超时推进；员工侧提交推进在 WP-16 细化）""",
"""  @Post('tasks/:id/publish')
  @Roles('hr_admin')
  publish(@Param('id', ParseIntPipe) id: number) { return this.svc.publish(id); }

  // 节点推进（HR 手动推进/超时推进；员工侧提交推进在 WP-16 细化）""")
io.open(p, 'w', encoding='utf-8').write(s)

p = 'src/app.module.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("import { TaskModule } from './modules/task/task.module';",
"import { TaskModule } from './modules/task/task.module';\nimport { DataFillModule } from './modules/datafill/datafill.module';")
s = s.replace("imports: [PrismaModule, AuthModule, OrgModule, IndicatorModule, AuditModule, SchemeModule, TaskModule],",
"imports: [PrismaModule, AuthModule, OrgModule, IndicatorModule, AuditModule, SchemeModule, DataFillModule, TaskModule],")
io.open(p, 'w', encoding='utf-8').write(s)
print('modules wired')
