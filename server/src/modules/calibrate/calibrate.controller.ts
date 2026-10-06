// WP-21 校准控制器（FR-M06-002/003）
import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { CalibrateService } from './calibrate.service';

class GradeDto { @IsString() @IsNotEmpty() grade: string; @IsOptional() @IsString() reason?: string; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class CalibrateController {
  constructor(private svc: CalibrateService) {}

  @Post('records/:id/grade')
  @Roles('hr_admin', 'manager', 'manager_up')
  grade(@Param('id', ParseIntPipe) id: number, @Body() dto: GradeDto) { return this.svc.assignGrade(id, dto.grade, dto.reason); }

  @Get('tasks/:id/distribution')
  @Roles('hr_admin', 'manager')
  dist(@Param('id', ParseIntPipe) id: number) { return this.svc.distribution(id); }
}
