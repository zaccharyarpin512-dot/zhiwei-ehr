// WP-25 报表控制器（FR-M09-001/002/003）
import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { ReportService } from './report.service';
import { ReportService2 } from './report2.service';
import { PrismaService } from '../../prisma.service';
import { Body, Post } from '@nestjs/common';

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class ReportController {
  constructor(private svc: ReportService, private r2: ReportService2, private prisma: PrismaService) {}

  @Post('reports')
  submitReport(@Body() dto: any) { return this.r2.submit(dto); }

  @Get('reports/team')
  teamReports(@Query('from') from: string, @Query('to') to: string, @Query('type') type: string) { return this.r2.teamReports(from, to, type || 'weekly'); }

  @Post('reports/:id/comment')
  commentReport(@Param('id', ParseIntPipe) id: number, @Body() dto: { text: string }) { return this.r2.comment(id, dto.text); }

  @Get('records/:id/task-stat')
  statCard(@Param('id', ParseIntPipe) id: number) { return this.r2.statCard(id); }

  // WP-35a：皮肤/偏好账号级读写（FR-M11-006 多端同步）
  @Get('me/preference')
  async getPref() { const { PreferenceService } = await import('../preference.service'); return new PreferenceService(this.svc as any, this.prisma as any).get(); }

  @Post('me/preference')
  async setPref(@Body() dto: any) { const { PreferenceService } = await import('../preference.service'); return new PreferenceService(this.svc as any, this.prisma as any).set(dto); }

  // WP-35b：PIP 发起（C/D 级，留痕 + 员工待办）
  @Post('records/:id/pip')
  async pip(@Param('id', ParseIntPipe) id: number, @Body() dto: { goals: string; deadline: string }) {
    const { PreferenceService } = await import('../preference.service');
    return new PreferenceService(this.svc as any, this.prisma as any).pip(id, dto);
  }

  @Post('records/:id/task-credit')
  @Roles('hr_admin', 'manager')
  applyCredit(@Param('id', ParseIntPipe) id: number) { return this.r2.applyCredit(id); }

  @Get('records/:id/report')
  personal(@Param('id', ParseIntPipe) id: number) { return this.svc.personalReport(id); }

  @Get('tasks/:id/report/progress')
  @Roles('hr_admin', 'hr', 'manager')
  progress(@Param('id', ParseIntPipe) id: number) { return this.svc.progressBoard(id); }

  @Get('tasks/:id/report/distribution')
  @Roles('hr_admin', 'hr', 'manager')
  distribution(@Param('id', ParseIntPipe) id: number, @Query('by') by?: string) {
    return this.svc.distribution(id, by === 'grade' ? 'grade' : 'dept');
  }
}
