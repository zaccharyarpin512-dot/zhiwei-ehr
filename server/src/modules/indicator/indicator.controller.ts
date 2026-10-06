// M02 指标库（FR-M02-001/002/004）：指标 CRUD + 口径校验 + 分类 + 填报人
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { IndicatorService } from './indicator.service';

export class CategoryDto { @IsString() @IsNotEmpty() name: string; @IsOptional() sortNo?: number; }

export class IndicatorDto {
  @IsString() @IsNotEmpty() @MaxLength(50) name: string;
  @IsOptional() categoryId?: number;
  @IsOptional() definition?: string;
  @IsOptional() calcDesc?: string;
  @IsOptional() scoreRule?: any;
  @IsIn(['current', 'ytd', 'cumulative']) statScope: 'current' | 'ytd' | 'cumulative';
  @IsOptional() @IsIn(['task_start', 'hire_date', 'custom_date']) cumulativeFrom?: 'task_start' | 'hire_date' | 'custom_date';
  @IsIn(['dept_report', 'self_report', 'auto_system', 'manager_review']) sourceType: string;
  @IsOptional() dataOwnerDeptId?: number;
  @IsOptional() unit?: string;
  @IsOptional() positionTags?: string[];
  @IsOptional() status?: '启用' | '停用';
}

export class FillersDto { @IsArray() @ArrayMaxSize(2, { message: '每个出数部门最多设置 2 名填报人' }) fillerEmpIds: number[]; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class IndicatorController {
  constructor(private svc: IndicatorService) {}

  // ---------- 分类 ----------
  @Get('indicator-categories')
  categories() { return this.svc.categories(); }

  @Post('indicator-categories')
  @Roles('hr_admin')
  createCategory(@Body() dto: CategoryDto) { return this.svc.createCategory(dto); }

  // ---------- 指标 ----------
  @Get('indicators')
  list(@Query('category_id') categoryId?: string, @Query('keyword') keyword?: string, @Query('for_scheme') forScheme?: string) {
    return this.svc.list({ categoryId: categoryId ? Number(categoryId) : undefined, keyword, forScheme: forScheme === '1' });
  }

  @Post('indicators')
  @Roles('hr_admin')
  create(@Body() dto: IndicatorDto) { return this.svc.create(dto); }

  @Put('indicators/:id')
  @Roles('hr_admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<IndicatorDto>) { return this.svc.update(id, dto); }

  @Delete('indicators/:id')
  @Roles('hr_admin')
  disable(@Param('id', ParseIntPipe) id: number) { return this.svc.disable(id); }

  // ---------- 出数部门填报人（FR-M02-004）----------
  @Get('departments/:id/data-fillers')
  fillers(@Param('id', ParseIntPipe) id: number) { return this.svc.getFillers(id); }

  @Put('departments/:id/data-fillers')
  @Roles('hr_admin')
  setFillers(@Param('id', ParseIntPipe) id: number, @Body() dto: FillersDto) {
    return this.svc.setFillers(id, dto.fillerEmpIds);
  }
}
