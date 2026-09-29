import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AssessmentModel } from './assessment.model.js';
import { validateAssessmentDraft } from './assessment.js';
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
  constructor(
    @Inject(RunsRepository) private readonly runs: RunsRepository,
    @Inject(AssessmentModel) private readonly model: AssessmentModel,
  ) {}

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

  async assess(id: string, questionId: unknown) {
    const search = await this.search(id, questionId, 'keyword');
    const existing = await this.runs.findAssessment(id, search.questionId);
    if (existing) {
      return { ...existing, sourceRevisionId: search.sourceRevisionId };
    }

    const sources = search.candidates.map(({ path, content }) => ({ path, content }));
    const draft = await this.model.generate(search.question, sources);
    const assessment = validateAssessmentDraft(draft, sources);
    const saved = await this.runs.saveOrGetAssessment({
      ...assessment,
      runId: id,
      questionId: search.questionId,
    });
    return { ...saved, sourceRevisionId: search.sourceRevisionId };
  }
}
