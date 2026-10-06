// WP-22 申诉/面谈控制器
import { Body, Controller, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { DisputeService } from './dispute.service';

class AppealDto { @IsString() @IsNotEmpty() reason: string; }
class HandleDto {
  @IsIn(['uphold', 'adjust']) result: 'uphold' | 'adjust';
  @IsString() @IsNotEmpty() note: string;
  @IsOptional() @IsNumber() newScore?: number;
  @IsOptional() @IsString() newGrade?: string;
}
class InterviewDto { @IsString() @IsNotEmpty() summary: string; @IsOptional() @IsString() improvementGoals?: string; }
class ConfirmDto { @IsOptional() @IsString() comment?: string; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class DisputeController {
  constructor(private svc: DisputeService) {}

  @Post('records/:id/appeal')
  appeal(@Param('id', ParseIntPipe) id: number, @Body() dto: AppealDto) { return this.svc.appeal(id, dto.reason); }

  @Put('appeals/:id/handle')
  @Roles('hr_admin')
  handle(@Param('id', ParseIntPipe) id: number, @Body() dto: HandleDto) { return this.svc.handleAppeal(id, dto); }

  @Post('records/:id/interview')
  interview(@Param('id', ParseIntPipe) id: number, @Body() dto: InterviewDto) { return this.svc.interview(id, dto.summary, dto.improvementGoals); }

  @Post('records/:id/interview/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmDto) { return this.svc.confirmInterview(id, dto.comment); }
}
