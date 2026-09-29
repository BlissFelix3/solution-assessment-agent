import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RunsRepository } from './runs.repository.js';

const questions = new Map([
  ['employee-saml-sign-in', 'Can employees sign in with SAML 2.0?'],
  ['https-account-event-webhook', 'Can our HTTPS webhook receive account events from the platform?'],
  [
    'first-attempt-60-seconds',
    'Is the first account-event webhook delivery attempt guaranteed within 60 seconds?',
  ],
]);

@Injectable()
export class RunsService {
  constructor(@Inject(RunsRepository) private readonly runs: RunsRepository) {}

  async create() {
    const run = await this.runs.create();
    if (!run) {
      throw new ServiceUnavailableException('Source documents are not ready');
    }
    return { runId: run.id, sourceRevisionId: run.sourceRevisionId };
  }

  async search(id: string, questionId: unknown, mode: unknown) {
    if (typeof questionId !== 'string' || mode !== 'keyword') {
      throw new BadRequestException('Expected a prepared questionId and mode=keyword');
    }
    const question = questions.get(questionId);
    if (!question) {
      throw new BadRequestException('Unknown questionId');
    }

    const sourceRevisionId = await this.runs.findSourceRevision(id);
    if (!sourceRevisionId) {
      throw new NotFoundException('Run not found');
    }
    const candidates = await this.runs.searchKeyword(sourceRevisionId, question);

    return {
      runId: id,
      sourceRevisionId,
      questionId,
      question,
      mode: 'keyword',
      candidates,
    };
  }
}
