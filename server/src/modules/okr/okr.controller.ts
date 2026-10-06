// WP-30 OKR 控制器
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, RolesGuard } from '../../common/guards';
import { OkrService } from './okr.service';

class KrDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() measureType?: string;
  @IsOptional() @IsNumber() baseline?: number;
  @IsNumber() target: number;
  @IsOptional() @IsNumber() weight?: number;
}
class ObjectiveDto {
  @IsString() @IsNotEmpty() period: string;
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() alignToId?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => KrDto) keyResults: KrDto[];
}
class ProgressDto { @IsNumber() current: number; @IsOptional() @IsString() confidence?: string; }
class ScoreDto { @IsNumber() score: number; }

@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1')
export class OkrController {
  constructor(private svc: OkrService) {}

  @Post('objectives')
  create(@Body() dto: ObjectiveDto) { return this.svc.createObjective(dto); }

  @Get('objectives')
  mine(@Query('period') period?: string) { return this.svc.myObjectives(period); }

  @Get('objectives/:id')
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.getObjective(id); }

  @Put('key-results/:id/progress')
  progress(@Param('id', ParseIntPipe) id: number, @Body() dto: ProgressDto) { return this.svc.updateKrProgress(id, dto.current, dto.confidence); }

  @Post('key-results/:id/score')
  score(@Param('id', ParseIntPipe) id: number, @Body() dto: ScoreDto) { return this.svc.scoreKr(id, dto.score); }

  @Get('objectives/:id/align-tree')
  tree(@Param('id', ParseIntPipe) id: number) { return this.svc.alignTree(id); }
}
