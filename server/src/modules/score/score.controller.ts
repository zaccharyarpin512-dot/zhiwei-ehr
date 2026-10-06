// WP-20 汇总引擎接口（FR-M06-001）
import { Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { ScoreService } from './score.service';
import { RollupService } from './rollup.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class ScoreController {
  constructor(private svc: ScoreService, private rollup: RollupService) {}

  @Post('records/:id/aggregate')
  @Roles('hr_admin', 'manager')
  aggregate(@Param('id', ParseIntPipe) id: number) { return this.svc.aggregate(id); }

  @Get('records/:id/aggregate')
  detail(@Param('id', ParseIntPipe) id: number) { return this.svc.aggregate(id); }

  @Get('tasks/:id/rank')
  @Roles('hr_admin', 'manager')
  rank(@Param('id', ParseIntPipe) id: number) { return this.svc.rankByTask(id); }

  // WP-23/24 周期关联（FR-M03-005/FR-M05-009）
  @Get('schemes/:id/linkable-tasks')
  @Roles('hr_admin')
  linkable(@Param('id', ParseIntPipe) id: number, @Query('exclude_task_id') ex?: string) {
    return this.rollup.linkable(id, ex ? Number(ex) : undefined);
  }

  @Post('records/:id/rollup/compute')
  @Roles('hr_admin', 'manager')
  compute(@Param('id', ParseIntPipe) id: number) { return this.rollup.computeRollup(id); }

  @Post('records/:id/rollup/recalc')
  @Roles('hr_admin')
  recalc(@Param('id', ParseIntPipe) id: number) { return this.rollup.recalc(id); }
}
