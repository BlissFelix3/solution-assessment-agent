import { Module } from '@nestjs/common';
import { AssessmentModel } from './adapters/outbound/ai/assessment.model.js';
import { Database } from './adapters/outbound/postgres/database.js';
import { DemoRunsService } from './application/demo-runs.service.js';
import { InternalTokenGuard } from './adapters/inbound/http/internal-token.guard.js';
import { RunsController } from './adapters/inbound/http/runs.controller.js';
import { RunsRepository } from './adapters/outbound/postgres/runs.repository.js';
import { RunsService } from './application/runs.service.js';

@Module({
  controllers: [RunsController],
  providers: [Database, RunsRepository, AssessmentModel, RunsService, DemoRunsService, InternalTokenGuard],
})
export class AppModule {}
