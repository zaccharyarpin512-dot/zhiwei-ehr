// M03 方案控制器
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { SchemeService } from './scheme.service';

class IndicatorItem {
  @IsNotEmpty() indicatorId: number;
  @IsNotEmpty() weight: string | number;
  @IsOptional() defaultTarget?: string | number;
}
class NodeItem {
  @IsIn(['goal_setting', 'goal_approval', 'data_fill', 'self_review', 'peer_review', 'manager_review', 'calibrating', 'result_confirm', 'appealing', 'interviewing', 'archived']) nodeType: string;
  @IsNotEmpty() seq: number;
  @IsOptional() timeConfig?: any;
  @IsOptional() enabled?: boolean;
}
class QuestionItem { @IsNotEmpty() title: string; @IsIn(['scale', 'choice', 'multi', 'text']) qType: string; @IsOptional() options?: any; @IsOptional() required?: boolean; }
class GradeRuleItem { @IsNotEmpty() grade: string; @IsNotEmpty() minScore: string | number; @IsNotEmpty() maxScore: string | number; @IsOptional() ratioLimit?: string | number; @IsOptional() sortNo?: number; }
class ReviewerItem { @IsIn(['self', 'manager', 'manager_up', 'peer', 'subordinate']) reviewerType: string; @IsNotEmpty() weight: string | number; @IsOptional() config?: any; }

export class CreateSchemeDto {
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['kpi', 'okr', 'kpi_okr', 'e360', 'kpi_360']) mode: string;
  @IsIn(['month', 'quarter', 'half_year', 'year']) periodType: string;
  @IsOptional() scopeFilter?: any;
  @IsOptional() linkageConfig?: any;
  @IsOptional() taskCreditConfig?: any;
  @IsArray() @ValidateNested({ each: true }) @Type(() => IndicatorItem) indicators: IndicatorItem[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => NodeItem) nodes: NodeItem[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuestionItem) questions?: QuestionItem[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GradeRuleItem) gradeRules?: GradeRuleItem[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReviewerItem) reviewers?: ReviewerItem[];
}

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/schemes')
export class SchemeController {
  constructor(private svc: SchemeService) {}

  @Get()
  list() { return this.svc.list(); }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.get(id); }

  @Post()
  @Roles('hr_admin')
  create(@Body() dto: CreateSchemeDto) { return this.svc.create(dto); }

  @Put(':id')
  @Roles('hr_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: { name?: string }) { return this.svc.update(id, dto); }

  @Post(':id/copy')
  @Roles('hr_admin')
  copy(@Param('id', ParseIntPipe) id: number) { return this.svc.copy(id); }

  @Post('preview-audience')
  @Roles('hr_admin')
  preview(@Body() body: { scopeFilter?: any }) { return this.svc.previewAudience(body?.scopeFilter); }
}
