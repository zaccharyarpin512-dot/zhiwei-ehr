import { Module } from '@nestjs/common';
import { CalibrateController } from './calibrate.controller';
import { CalibrateService } from './calibrate.service';
@Module({ controllers: [CalibrateController], providers: [CalibrateService], exports: [CalibrateService] })
export class CalibrateModule {}
