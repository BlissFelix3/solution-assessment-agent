import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RunsService } from './runs.service.js';

@Controller('runs')
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Post()
  create() {
    return this.runs.create();
  }

  @Post(':id/assessments')
  assess(@Param('id', new ParseUUIDPipe()) id: string, @Body('questionId') questionId: unknown) {
    return this.runs.assess(id, questionId);
  }

  @Get(':id/assessments')
  listAssessments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.runs.listAssessments(id);
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
