import { CacheInterceptor } from '@nestjs/cache-manager';
import { Controller, Get, Header, ServiceUnavailableException, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MetaService } from './meta.service';

@ApiTags('meta')
@Controller()
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  /**
   * Liveness only. Deliberately does not touch the database: the host pings this
   * every few seconds, and a DB query each time would stop Neon from ever sleeping.
   */
  @Get('health')
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness check (does not query the database)' })
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('health/db')
  @ApiOperation({ summary: 'Readiness check: can the API reach the database?' })
  async healthDb() {
    try {
      await this.meta.ping();
      return { status: 'ok', database: 'up' };
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'error', database: 'down', message: (err as Error).message });
    }
  }

  @Get('outlets')
  @UseInterceptors(CacheInterceptor)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Outlets followed, with articles published in the last 24 hours' })
  outlets() {
    return this.meta.outlets();
  }

  @Get('stats')
  @UseInterceptors(CacheInterceptor)
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Pipeline health and AI usage over the last 24 hours' })
  stats() {
    return this.meta.stats();
  }
}
