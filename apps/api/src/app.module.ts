import { N8nExecutionReader } from './adapters/outbound/n8n/execution-reader.js';
import { LocalTextEmbedder } from './adapters/outbound/ai/text.embedder.js';
import { LocalEvidenceReranker } from './adapters/outbound/ai/evidence.reranker.js';
import { QueryPlanner } from './adapters/outbound/ai/query.planner.js';
import { PostgresEvidenceIndex } from './adapters/outbound/postgres/evidence.index.js';
import { RetrievalService } from './application/retrieval.service.js';
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
    { provide: LocalTextEmbedder, useFactory: () => new LocalTextEmbedder() },
    { provide: LocalEvidenceReranker, useFactory: () => new LocalEvidenceReranker() },
    { provide: QueryPlanner, useFactory: () => new QueryPlanner() },
    {
      provide: PostgresEvidenceIndex,
      inject: [Database],
      useFactory: (database: Database) => new PostgresEvidenceIndex(database),
    },
    {
      provide: RetrievalService,
      inject: [PostgresEvidenceIndex, LocalTextEmbedder, LocalEvidenceReranker, QueryPlanner],
      useFactory: (
        index: PostgresEvidenceIndex, embedder: LocalTextEmbedder,
        reranker: LocalEvidenceReranker, planner: QueryPlanner,
      ) => new RetrievalService(index, embedder, reranker, planner),
    },
    {
      provide: N8nExecutionReader,
      useFactory: () => {
        const logger = new Logger(N8nExecutionReader.name);
        return new N8nExecutionReader((message) => logger.warn(message));
      },
    },
    { provide: APP_FILTER, useClass: AssessmentErrorFilter },
    {
      provide: RunsService,
      inject: [RunsRepository, AssessmentModel, RetrievalService, N8nExecutionReader],
      useFactory: (
        runs: RunsRepository,
        model: AssessmentModel,
        retrieval: RetrievalService,
        workflow: N8nExecutionReader,
      ) => {
        const logger = new Logger(RunsService.name);
        return new RunsService(runs, model, (message) => logger.warn(message), retrieval, workflow);
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
