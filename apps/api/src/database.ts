import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }
    this.pool = new pg.Pool({ connectionString });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
