import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthGuard, Roles, RolesGuard } from '../../common/guards';
import { AiService } from './ai.service';
class SuggestDto { @IsString() @IsNotEmpty() duty: string; }
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/ai')
export class AiController {
  constructor(private svc: AiService) {}
  @Post('indicators/suggest')
  @Roles('hr_admin', 'hr', 'manager')
  suggest(@Body() dto: SuggestDto) { return this.svc.suggestIndicators(dto.duty); }
  @Post('goals/polish')
  @Roles('hr_admin','hr','manager')
  polish(@Body() dto: SuggestDto) { return this.svc.polishGoal(dto.duty); }

  @Post('reviews/draft')
  @Roles('hr_admin','hr','manager')
  draft(@Body() dto: { recordId: number }) { return this.svc.reviewDraft(Number(dto.recordId)); }

  @Get('config')
  @Roles('hr_admin')
  config() { return this.svc.config(); }
}
