import { Module } from '@nestjs/common';
import { StoriesModule } from '../stories/stories.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [StoriesModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
