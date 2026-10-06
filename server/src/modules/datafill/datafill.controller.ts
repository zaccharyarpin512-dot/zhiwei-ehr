// WP-14 数据填报控制器（FR-M05-008 + 9.2 接口组）
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { DataFillService } from './datafill.service';

class FillItemDto {
  @IsNumber() recordId: number;
  @IsNumber() indicatorId: number;
  @IsNumber() actualValue: number;
  @IsOptional() @IsString() evidenceNote?: string;
  @IsOptional() @IsString() evidenceFileUrl?: string;
}
class SubmitDto { @IsArray() @ValidateNested({ each: true }) @Type(() => FillItemDto) items: FillItemDto[]; }
class ReturnDto { @IsString() @IsNotEmpty() reason: string; }
class ObjectionDto { @IsString() @IsNotEmpty() reason: string; @IsOptional() @IsString() evidenceFileUrl?: string; }
class HandleDto {
  @IsString() @IsNotEmpty() result: 'keep' | 'fix';
  @IsOptional() @IsNumber() newValue?: number;
  @IsOptional() @IsString() comment?: string;
}

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class DataFillController {
  constructor(private svc: DataFillService) {}

  @Get('data-fill-orders')
  list(@Query('task_id') taskId?: string, @Query('status') status?: string) {
    return this.svc.listOrders({ taskId: taskId ? Number(taskId) : undefined, status });
  }

  @Get('data-fill-orders/:id')
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.getOrder(id); }

  @Post('data-fill-orders/:id/submit')
  submit(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) { return this.svc.submitOrder(id, dto.items); }

  @Post('data-fill-orders/:id/return')
  @Roles('hr_admin')
  returnOrder(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnDto) { return this.svc.returnOrder(id, dto.reason); }

  @Post('data-fill-orders/:id/settle')
  @Roles('hr_admin')
  settle(@Param('id', ParseIntPipe) id: number) { return this.svc.settleOrder(id); }

  @Post('data-fill-items/:id/objection')
  objection(@Param('id', ParseIntPipe) id: number, @Body() dto: ObjectionDto) {
    return this.svc.raiseObjection(id, dto.reason, dto.evidenceFileUrl);
  }

  @Put('objections/:id')
  handle(@Param('id', ParseIntPipe) id: number, @Body() dto: HandleDto) { return this.svc.handleObjection(id, dto); }
}
