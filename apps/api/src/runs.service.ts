import {
  BadRequestException,
  ConflictException,
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

  async create(executionId: unknown) {
    if (typeof executionId !== 'string' || !/^\d{1,20}$/.test(executionId)) {
      throw new BadRequestException('Expected an n8n execution ID');
    }
    const run = await this.runs.create(executionId);
    if (!run) {
      throw new ServiceUnavailableException('Source documents are not ready');
    }
    return { runId: run.id, sourceRevisionId: run.sourceRevisionId };
  }

  async complete(id: string) {
    if (!await this.runs.complete(id)) {
      if (!await this.runs.findRun(id)) {
        throw new NotFoundException('Run not found');
      }
      throw new ConflictException('Run is incomplete or failed');
    }
    return { runId: id, status: 'completed' as const };
  }

  async failExecution(executionId: string) {
    if (!/^\d{1,20}$/.test(executionId)) {
      throw new BadRequestException('Expected an n8n execution ID');
    }
    await this.runs.failExecution(executionId);
  }

  async search(id: string, questionId: unknown, mode: unknown) {
    if (typeof questionId !== 'string' || mode !== 'keyword') {
      throw new BadRequestException('Expected a prepared questionId and mode=keyword');
    }
    const question = questions.get(questionId);
    if (!question) {
      throw new BadRequestException('Unknown questionId');
    }

    const run = await this.runs.findRun(id);
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const sourceRevisionId = run.sourceRevisionId;
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

  async listAssessments(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const assessments = await this.runs.listAssessments(id);
    const status = run.status === 'pending' &&
      Date.now() - run.createdAt.getTime() >= 10 * 60 * 1000
      ? 'timed_out' : run.status;
    return { runId: id, sourceRevisionId: run.sourceRevisionId, status, assessments };
  }

  async getSource(id: string, path: unknown) {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new BadRequestException('Expected a source path');
    }
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const sourceRevisionId = run.sourceRevisionId;
    const source = await this.runs.findSource(sourceRevisionId, path);
    if (!source) {
      throw new NotFoundException('Source not found in run revision');
    }
    return { sourceRevisionId, ...source };
  }
}
