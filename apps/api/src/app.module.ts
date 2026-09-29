import { Module } from '@nestjs/common';
import { AssessmentModel } from './assessment.model.js';
import { Database } from './database.js';
import { RunsController } from './runs.controller.js';
import { RunsRepository } from './runs.repository.js';
import { RunsService } from './runs.service.js';

@Module({ controllers: [RunsController], providers: [Database, RunsRepository, AssessmentModel, RunsService] })
export class AppModule {}
