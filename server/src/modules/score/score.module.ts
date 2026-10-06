import { Module } from '@nestjs/common';
import { ScoreController } from './score.controller';
import { ScoreService } from './score.service';
import { RollupService } from './rollup.service';
@Module({ controllers: [ScoreController], providers: [ScoreService, RollupService], exports: [ScoreService, RollupService] })
export class ScoreModule {}
