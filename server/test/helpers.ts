// 测试助手：构建应用 + 租户/用户种子数据（每个用例独立租户，天然隔离）
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { registerExceptionFilter } from '../src/common/guards';
import { signAccess } from '../src/lib/jwt';

// BigInt 序列化：Prisma BigInt 主键/外键 → JSON number（PRD 9.1 响应格式）
(BigInt.prototype as any).toJSON = function () { return Number(this); };

let seq = 0;

export async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  (app as any).setGlobalPrefix('');
  const { ValidationPipe } = require('@nestjs/common');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  registerExceptionFilter(app);
  // 全局中间件（同 main.ts 行为）
  const { TenantMiddleware } = require('../src/tenant.middleware');
  app.use((req: any, res: any, next: any) => new TenantMiddleware().use(req, res, next));
  await app.init();
  // 显式监听随机端口：避免 supertest 自管理 listen/close 的竞态
  await app.listen(0);
  return app;
}

export interface SeedResult {
  tenantId: number;
  hrToken: string;     // hr_admin
  hrUserId: number;
  empToken: string;    // employee
  empUserId: number;
  mgrToken: string;    // manager
  mgrUserId: number;
}

export async function seedTenant(app: INestApplication, roles?: Partial<{ emp: string[]; mgr: string[] }>): Promise<SeedResult> {
  const prisma = app.get(PrismaService) as any;
  const n = ++seq;
  const tenant = await prisma.tenant.create({ data: { name: `租户${n}` } });
  const tid = Number(tenant.id);
  // 手机号必须全局唯一：jest 多 worker 并行共享一个测试库，登录按 mobile 查询会跨租户撞号
  const pid = String(process.pid % 100).padStart(2, '0');
  const mkUser = async (mobile: string, name: string, r: string[]) => {
    const u = await prisma.user.create({
      data: { tenantId: tid, mobile, name, passwordHash: await bcrypt.hash('Passw0rd!', 8), roles: r },
    });
    return { id: Number(u.id), u };
  };
  const hr = await mkUser(`139${pid}${String(n).padStart(4, '0')}01`, '徐HR', ['hr_admin']);
  const emp = await mkUser(`139${pid}${String(n).padStart(4, '0')}02`, '李四', roles?.emp || ['employee']);
  const mgr = await mkUser(`139${pid}${String(n).padStart(4, '0')}03`, '王经理', roles?.mgr || ['manager']);
  const tk = (uid: number, r: string[]) => `Bearer ${signAccess({ uid, tid, roles: r })}`;
  return {
    tenantId: tid,
    hrToken: tk(hr.id, ['hr_admin']), hrUserId: hr.id,
    empToken: tk(emp.id, roles?.emp || ['employee']), empUserId: emp.id,
    mgrToken: tk(mgr.id, roles?.mgr || ['manager']), mgrUserId: mgr.id,
  };
}

export async function cleanTenant(app: INestApplication, tenantId: number) {
  const prisma = app.get(PrismaService) as any;
  await prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE tenant_id=$1`, tenantId);
  for (const t of ['indicator_objection','data_fill_item','data_fill_order','record_status_log','record_reviewer','record_indicator','assessment_record','assessment_task','scheme_reviewer','scheme_grade_rule','scheme_question','scheme_indicator','scheme_node','scheme']) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE tenant_id=$1`, tenantId);
  }
  await prisma.$executeRawUnsafe(`DELETE FROM dept_data_filler WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM indicator WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM indicator_category WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM employee_transfer_log WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM employee WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM department WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM user_preference WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE tenant_id=$1`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenant WHERE id=$1`, tenantId);
}
