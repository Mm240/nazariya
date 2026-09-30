import { Module } from '@nestjs/common';
import { AdminController, EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';

@Module({
  controllers: [EngagementController, AdminController],
  providers: [EngagementService],
})
export class EngagementModule {}
