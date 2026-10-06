import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma.module';
import { TenantMiddleware } from './tenant.middleware';
import { AuthGuard, RolesGuard } from './common/guards';
import { AuthModule } from './modules/auth/auth.module';
import { OrgModule } from './modules/org/org.module';
import { IndicatorModule } from './modules/indicator/indicator.module';
import { AuditModule } from './modules/audit/audit.module';
import { SchemeModule } from './modules/scheme/scheme.module';
import { TaskModule } from './modules/task/task.module';
import { DataFillModule } from './modules/datafill/datafill.module';
import { ReviewModule } from './modules/review/review.module';
import { TodoModule } from './modules/todo/todo.module';
import { ScoreModule } from './modules/score/score.module';
import { CalibrateModule } from './modules/calibrate/calibrate.module';
import { DisputeModule } from './modules/dispute/dispute.module';
import { ReportModule } from './modules/report/report.module';
import { PeerModule } from './modules/peer/peer.module';
import { OkrModule } from './modules/okr/okr.module';
import { WorkModule } from './modules/work/work.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [PrismaModule, AuthModule, OrgModule, IndicatorModule, AuditModule, SchemeModule, DataFillModule, TaskModule, ReviewModule, TodoModule, ScoreModule, CalibrateModule, DisputeModule, ReportModule, PeerModule, OkrModule, WorkModule, AiModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },   // 全局认证
    { provide: APP_GUARD, useClass: RolesGuard },  // 全局角色校验（按 @Roles 元数据）
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
