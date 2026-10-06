import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportService2 } from './report2.service';
@Module({ controllers: [ReportController], providers: [ReportService, ReportService2], exports: [ReportService, ReportService2] })
export class ReportModule {}
