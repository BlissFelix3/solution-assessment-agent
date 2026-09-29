import { Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RunsService } from './runs.service.js';

@Controller('runs')
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Post()
  create() {
    return this.runs.create();
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
