// WP-29 360 环评控制器
import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { PeerService } from './peer.service';

class AssignDto { @IsNumber() count: number; }
class AnswerDto { @IsNumber() questionId: number; @IsNumber() value: number; }
class SubmitDto { @IsArray() @ValidateNested({ each: true }) @Type(() => AnswerDto) answers: AnswerDto[]; @IsOptional() @IsString() comment?: string; }
class AggregateDto { @IsOptional() @IsBoolean() trimExtremes?: boolean; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class PeerController {
  constructor(private svc: PeerService) {}

  @Post('records/:id/peers/assign')
  @Roles('hr_admin', 'manager')
  assign(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignDto) { return this.svc.assignPeers(id, dto.count); }

  @Post('reviewers/:id/answer')
  answer(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitDto) { return this.svc.submitAnswer(id, dto.answers, dto.comment); }

  @Post('records/:id/peer-aggregate')
  @Roles('hr_admin', 'manager')
  aggregate(@Param('id', ParseIntPipe) id: number, @Body() dto: AggregateDto) { return this.svc.aggregate(id, dto.trimExtremes); }

  @Get('records/:id/peer-reviewers')
  reviewers(@Param('id', ParseIntPipe) id: number) { return this.svc.anonymizedReviewers(id); }
}
