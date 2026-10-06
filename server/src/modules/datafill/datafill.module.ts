import { Module } from '@nestjs/common';
import { DataFillController } from './datafill.controller';
import { DataFillService } from './datafill.service';
@Module({ controllers: [DataFillController], providers: [DataFillService], exports: [DataFillService] })
export class DataFillModule {}
