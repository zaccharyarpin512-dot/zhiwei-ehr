// WP-31/32 过程任务控制器
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AuthGuard, RolesGuard } from '../../common/guards';
import { WorkService } from './work.service';

class TaskDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() assigneeEmpId?: number;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsNumber() rewardPoints?: number;
  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsNumber() krId?: number;
}
class TransDto { @IsString() @IsNotEmpty() to: string; @IsOptional() @IsString() note?: string; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class WorkController {
  constructor(private svc: WorkService) {}

  @Post('work-tasks')
  create(@Body() dto: TaskDto) { return this.svc.create(dto); }

  @Get('work-tasks')
  list(@Query('view') view: 'mine' | 'published' | 'market' = 'mine') { return this.svc.list(view); }

  @Post('work-tasks/:id/claim')
  claim(@Param('id', ParseIntPipe) id: number) { return this.svc.claim(id); }

  @Post('work-tasks/:id/transition')
  transition(@Param('id', ParseIntPipe) id: number, @Body() dto: TransDto) { return this.svc.transition(id, dto.to, dto.note); }

  @Post('work-tasks/:id/abandon')
  abandon(@Param('id', ParseIntPipe) id: number) { return this.svc.abandon(id); }

  @Get('work-tasks/calendar')
  calendar(@Query('from') from: string, @Query('to') to: string) { return this.svc.calendar(new Date(from), new Date(to)); }

  @Get('reward-account')
  account(@Query('emp_id') empId?: string) { return this.svc.account(empId ? Number(empId) : undefined); }

  @Get('employees/:id/task-stat')
  stat(@Param('id', ParseIntPipe) id: number, @Query('from') from: string, @Query('to') to: string) {
    return this.svc.taskStat(id, new Date(from), new Date(to));
  }
}
