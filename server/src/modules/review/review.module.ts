import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
@Module({ imports: [TaskModule], controllers: [ReviewController], providers: [ReviewService] })
export class ReviewModule {}
