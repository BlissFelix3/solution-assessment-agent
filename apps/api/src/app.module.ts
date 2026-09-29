import { Module } from '@nestjs/common';
import { Database } from './database.js';
import { RunsController } from './runs.controller.js';
import { RunsRepository } from './runs.repository.js';
import { RunsService } from './runs.service.js';

@Module({ controllers: [RunsController], providers: [Database, RunsRepository, RunsService] })
export class AppModule {}
