import { Logger, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AssessmentModel } from './adapters/outbound/ai/assessment.model.js';
import { Database } from './adapters/outbound/postgres/database.js';
import { N8nWorkflowStarter } from './adapters/outbound/n8n/workflow-starter.js';
import { RunsRepository } from './adapters/outbound/postgres/runs.repository.js';
import { AssessmentErrorFilter } from './adapters/inbound/http/assessment-error.filter.js';
import { InternalTokenGuard } from './adapters/inbound/http/internal-token.guard.js';
import { RunsController } from './adapters/inbound/http/runs.controller.js';
import { DemoRunsService } from './application/demo-runs.service.js';
import { RunsService } from './application/runs.service.js';

@Module({
  controllers: [RunsController],
  providers: [
    Database,
    RunsRepository,
    AssessmentModel,
    N8nWorkflowStarter,
    InternalTokenGuard,
    { provide: APP_FILTER, useClass: AssessmentErrorFilter },
    {
      provide: RunsService,
      inject: [RunsRepository, AssessmentModel],
      useFactory: (runs: RunsRepository, model: AssessmentModel) => {
        const logger = new Logger(RunsService.name);
        return new RunsService(runs, model, (message) => logger.warn(message));
      },
    },
    {
      provide: DemoRunsService,
      inject: [RunsRepository, N8nWorkflowStarter],
      useFactory: (runs: RunsRepository, workflow: N8nWorkflowStarter) => {
        const logger = new Logger(DemoRunsService.name);
        return new DemoRunsService(runs, workflow, (message) => logger.warn(message));
      },
    },
  ],
})
export class AppModule {}
