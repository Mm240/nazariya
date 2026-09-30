import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow, types } from 'pg';

// BIGINT (ids, count(*)) arrives as a string by default. Every value we return
// is far below 2^53, so plain numbers are safe and nicer for API clients.
types.setTypeParser(types.builtins.INT8, (value: string) => Number(value));

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. See DEPLOY.md.');
    }
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      // A scaled-to-zero Neon database takes a moment to wake up.
      connectionTimeoutMillis: 15_000,
    });
    this.pool.on('error', (err) => this.logger.error(`Idle database client error: ${err.message}`));
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
