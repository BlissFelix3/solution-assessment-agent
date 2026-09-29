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

}
