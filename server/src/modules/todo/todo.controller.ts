// WP-17 待办/消息/催办控制器（FR-M10-001/002/003）
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsNumber } from 'class-validator';
import { AuthGuard, RolesGuard } from '../../common/guards';
import { TodoService } from './todo.service';

class RemindDto { @IsArray() @IsNumber({}, { each: true }) recordIds: number[]; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class TodoController {
  constructor(private svc: TodoService) {}

  @Get('todos')
  todos(@Query('status') status?: string) { return this.svc.listTodos(status); }

  @Post('todos/:id/done')
  done(@Param('id', ParseIntPipe) id: number) { return this.svc.done(id); }

  @Get('messages')
  messages(@Query('unread') unread?: string) { return this.svc.listMessages(unread); }

  @Put('messages/:id/read')
  read(@Param('id', ParseIntPipe) id: number) { return this.svc.readMessage(id); }

  @Post('tasks/:id/remind')
  remind(@Param('id', ParseIntPipe) id: number, @Body() dto: RemindDto) { return this.svc.remind(id, dto.recordIds); }
}
