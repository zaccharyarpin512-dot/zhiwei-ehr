// PrismaService：连接管理 + 租户隔离扩展（FR-M11-004 硬约束）
// 1) 所有业务查询强制注入 tenant_id；跨租户访问一律 404
// 2) 审计：对清单内模型的写操作自动记录 before/after（FR-M11-003，append-only）
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantALS } from './tenant-context';

// 带 tenantId 的业务模型（登录期的 user 查询在 ALS 之外，不受扩展影响）
const TENANT_MODELS = new Set([
  'Department', 'Employee', 'EmployeeTransferLog',
  'IndicatorCategory', 'Indicator', 'DeptDataFiller',
  'Todo', 'Message', 'AuditLog',
  'Scheme', 'SchemeNode', 'SchemeIndicator', 'SchemeQuestion', 'SchemeGradeRule', 'SchemeReviewer',
  'AssessmentTask', 'AssessmentRecord', 'RecordIndicator', 'RecordReviewer', 'RecordStatusLog',
  'Appeal', 'InterviewRecord', 'Objective', 'KeyResult', 'WorkTask', 'MarketClaimLog', 'RewardAccount', 'RewardFlow', 'Report', 'AiConfig', 'AiInvocationLog',
  'DataFillOrder', 'DataFillItem', 'IndicatorObjection',
]);
const AUDITED_MODELS = new Set(['Department', 'Employee', 'Indicator', 'IndicatorCategory', 'DeptDataFiller', 'Scheme', 'DataFillItem']);
const READ_ACTIONS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate']);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const base = this as any;
    // @ts-ignore 查询行为扩展
    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            const c = tenantALS.getStore();
            const a = args || {};
            const delegate = base[model.charAt(0).toLowerCase() + model.slice(1)];
            if (TENANT_MODELS.has(model) && c) {
              if (['findMany', 'count', 'findFirst', 'updateMany', 'deleteMany'].includes(operation)) {
                a.where = { ...(a.where || {}), tenantId: c.tenantId };
              } else if (['update', 'delete'].includes(operation)) {
                const exists = await delegate.findFirst({ where: { AND: [a.where, { tenantId: c.tenantId }] } });
                if (!exists) return null; // 跨租户/不存在 → 服务层转 404
              } else if (operation === 'create' && a.data) {
                a.data.tenantId = c.tenantId;
              }
            }
            let beforeVal: any = null;
            if (AUDITED_MODELS.has(model) && c && !READ_ACTIONS.has(operation) && ['update', 'delete'].includes(operation)) {
              const found = await delegate.findFirst({ where: a.where });
              beforeVal = found ? JSON.parse(JSON.stringify(found)) : null;
            }
            const result = await query(a);
            if (AUDITED_MODELS.has(model) && c && !READ_ACTIONS.has(operation)) {
              const afterVal = result ? JSON.parse(JSON.stringify(result)) : null;
              // audit_log 自身不走扩展，防递归
              await base.$executeRawUnsafe(
                `INSERT INTO audit_log (tenant_id,user_id,action,resource_type,resource_id,before,after,ip,created_at)
                 VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,NOW())`,
                c.tenantId, c.userId, operation, model,
                String(result?.id ?? a.where?.id ?? ''),
                beforeVal ? JSON.stringify(beforeVal) : null,
                afterVal ? JSON.stringify(afterVal) : null,
                null,
              );
            }
            return result;
          },
        },
      },
    });
    // 生命周期钩子挂到扩展实例上（Nest 按实例方法调用）
    (extended as any).onModuleInit = async () => { await this.$connect(); };
    (extended as any).onModuleDestroy = async () => { await this.$disconnect(); };
    return extended as any;
  }

  async onModuleInit() { /* 实际由扩展实例上的副本执行 */ }
  async onModuleDestroy() { /* 同上 */ }
}
