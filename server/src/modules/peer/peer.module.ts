import { Module } from '@nestjs/common';
import { PeerController } from './peer.controller';
import { PeerService } from './peer.service';
@Module({ controllers: [PeerController], providers: [PeerService], exports: [PeerService] })
export class PeerModule {}
