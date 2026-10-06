import { Module } from '@nestjs/common';
import { IndicatorController } from './indicator.controller';
import { IndicatorService } from './indicator.service';
@Module({ controllers: [IndicatorController], providers: [IndicatorService], exports: [IndicatorService] })
export class IndicatorModule {}
