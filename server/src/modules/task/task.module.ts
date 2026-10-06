import { Module } from '@nestjs/common';
import { DataFillModule } from '../datafill/datafill.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
@Module({ imports: [DataFillModule], controllers: [TaskController], providers: [TaskService], exports: [TaskService] })
export class TaskModule {}
