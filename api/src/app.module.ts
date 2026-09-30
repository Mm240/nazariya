import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { EngagementModule } from './engagement/engagement.module';
import { MetaModule } from './meta/meta.module';
import { StoriesModule } from './stories/stories.module';

@Module({
  imports: [
    // The pipeline refreshes data every 30 minutes, so a 60-second response cache
    // costs nothing in freshness and keeps the free-tier database asleep more often.
    CacheModule.register({ isGlobal: true, ttl: 60_000 }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    StoriesModule,
    MetaModule,
    EngagementModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
