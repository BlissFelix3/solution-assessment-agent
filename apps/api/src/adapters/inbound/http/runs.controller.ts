import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DemoRunsService } from '../../../application/demo-runs.service.js';
import { InternalTokenGuard } from './internal-token.guard.js';
import { RunsService } from '../../../application/runs.service.js';

@Controller('runs')
export class RunsController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(DemoRunsService) private readonly demoRuns: DemoRunsService,
  ) {}

  @Post('demo')
  @HttpCode(202)
  startDemo(@Body('requirements') requirements: unknown) {
    return this.demoRuns.start(requirements);
  }

  @Post()
  @UseGuards(InternalTokenGuard)
  create(@Body('executionId') executionId: unknown, @Body('requirements') requirements: unknown) {
    return this.runs.create(executionId, requirements);
  }

  @Post(':id/dossier')
  @HttpCode(200)
  @UseGuards(InternalTokenGuard)
  createDossier(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.runs.createDossier(id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @UseGuards(InternalTokenGuard)
  complete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.runs.complete(id);
  }

  @Post('executions/:executionId/fail')
  @HttpCode(204)
  @UseGuards(InternalTokenGuard)
  failExecution(@Param('executionId') executionId: string) {
    return this.runs.failExecution(executionId);
  }

  @Post(':id/assessments')
  @UseGuards(InternalTokenGuard)
  assess(@Param('id', new ParseUUIDPipe()) id: string, @Body('questionId') questionId: unknown) {
    return this.runs.assess(id, questionId);
  }

  @Get(':id/assessments')
  listAssessments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.runs.listAssessments(id);
  }

  @Get(':id/trace')
  getTrace(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.runs.getTrace(id);
  }

  @Get(':id/sources')
  getSource(@Param('id', new ParseUUIDPipe()) id: string, @Query('path') path: unknown) {
    return this.runs.getSource(id, path);
  }

  @Get(':id/search')
  search(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('questionId') questionId: unknown,
    @Query('mode') mode: unknown,
  ) {
    return this.runs.search(id, questionId, mode);
  }
}
