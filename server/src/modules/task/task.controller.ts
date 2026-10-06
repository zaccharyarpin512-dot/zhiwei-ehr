// M05 考核任务控制器（FR-M05-001）
import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { TaskService } from './task.service';

export class CreateTaskDto {
  @IsNotEmpty() schemeId: number;
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() period: string;
  @IsString() @IsNotEmpty() startDate: string;
  @IsString() @IsNotEmpty() endDate: string;
  @IsOptional() @IsArray() linkedTaskIds?: number[];
}

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class TaskController {
  constructor(private svc: TaskService) {}

  @Post('tasks')
  @Roles('hr_admin')
  create(@Body() dto: CreateTaskDto) { return this.svc.create(dto); }

  @Get('tasks')
  list() { return this.svc.list(); }

  @Get('tasks/:id')
  detail(@Param('id', ParseIntPipe) id: number) { return this.svc.detail(id); }

  @Get('tasks/:id/records')
  records(@Param('id', ParseIntPipe) id: number) { return this.svc.listRecords(id); }

  @Get('records/:id')
  getRecord(@Param('id', ParseIntPipe) id: number) { return this.svc.getRecord(id); }

  @Post('tasks/:id/publish')
  @Roles('hr_admin')
  publish(@Param('id', ParseIntPipe) id: number) { return this.svc.publish(id); }

  // 节点推进（HR 手动推进/超时推进专用；员工侧一律走提交动作触发，防自我放行）
  @Post('records/:id/advance')
  @Roles('hr_admin')
  advance(@Param('id', ParseIntPipe) id: number, @Body() body: { toStatus: string; note?: string }) {
    return this.svc.advance(id, body.toStatus, body.note);
  }
}
