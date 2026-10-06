// WP-16 评价流程控制器（FR-M05-002/003/004）
import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, RolesGuard } from '../../common/guards';
import { ReviewService } from './review.service';

class TargetDto { @IsNumber() indicatorId: number; @IsNumber() targetValue: number; }
class ScoreDto { @IsNumber() indicatorId: number; @IsNumber() score: number; @IsOptional() @IsString() comment?: string; }
class GoalDto { @IsArray() @ValidateNested({ each: true }) @Type(() => TargetDto) targets: TargetDto[]; }
class SelfDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ScoreDto) scores: ScoreDto[];
  @IsOptional() @IsString() summary?: string;
}
class MgrDto { @IsArray() @ValidateNested({ each: true }) @Type(() => ScoreDto) scores: ScoreDto[]; }
class ApproveDto { @IsBoolean() pass: boolean; @IsOptional() @IsString() comment?: string; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/records')
export class ReviewController {
  constructor(private svc: ReviewService) {}

  @Post(':id/goal')
  goal(@Param('id', ParseIntPipe) id: number, @Body() dto: GoalDto) { return this.svc.submitGoal(id, dto.targets); }

  @Post(':id/goal/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto) { return this.svc.approveGoal(id, dto.pass, dto.comment); }

  @Post(':id/self-review')
  self(@Param('id', ParseIntPipe) id: number, @Body() dto: SelfDto) { return this.svc.submitSelfReview(id, dto.scores, dto.summary); }

  @Post(':id/manager-review')
  mgr(@Param('id', ParseIntPipe) id: number, @Body() dto: MgrDto) { return this.svc.submitManagerReview(id, dto.scores); }
}
