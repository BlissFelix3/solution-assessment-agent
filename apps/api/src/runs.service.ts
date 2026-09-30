import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AssessmentModel, instruction, maxOutputTokens, modelName, responseSchema, thinkingBudget } from './assessment.model.js';
import { validateAssessmentDraft } from './assessment.js';
import { buildImplementationPath } from './implementation-path.js';
import { RunsRepository } from './runs.repository.js';
import { assessmentTraceData, type RunEvent } from './run-trace.js';

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
  private readonly logger = new Logger(RunsService.name);

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

  async createDossier(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (run.implementationPath) {
      return { runId: id, sourceRevisionId: run.sourceRevisionId, implementationPath: run.implementationPath };
    }
    const assessments = await this.runs.listAssessments(id);
    if (assessments.length !== 3) {
      throw new ConflictException('Run needs three assessments before its dossier');
    }
    const path = buildImplementationPath(assessments);
    const saved = await this.runs.saveImplementationPath(id, path);
    if (!saved) {
      throw new ConflictException('Run cannot save its dossier');
    }
    return { runId: id, sourceRevisionId: run.sourceRevisionId, implementationPath: saved };
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
    if (typeof questionId !== 'string') {
      throw new BadRequestException('Expected a prepared questionId');
    }
    const question = questions.get(questionId);
    if (!question) {
      throw new BadRequestException('Unknown questionId');
    }
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const attemptId = randomUUID();
    const record = (stage: RunEvent['stage'], status: RunEvent['status'], data: RunEvent['data']) =>
      this.runs.appendEvent(id, { stage, status, questionId, attemptId, data });
    const existing = await this.runs.findAssessment(id, questionId);
    if (existing) {
      await record('persistence', 'succeeded', { assessment: existing, reused: true });
      return { ...existing, sourceRevisionId: run.sourceRevisionId };
    }

    let stage: RunEvent['stage'] = 'retrieval';
    try {
      await record(stage, 'started', {
        question, mode: 'keyword', sourceRevisionId: run.sourceRevisionId, limit: 5,
      });
      const candidates = await this.runs.searchKeyword(run.sourceRevisionId, question);
      await record(stage, 'succeeded', { candidates, count: candidates.length });

      stage = 'generation';
      const sources = candidates.map(({ path, content }) => ({ path, content }));
      await record(stage, 'started', {
        model: modelName, instruction, responseSchema, question, sources, maxOutputTokens, thinkingBudget,
      });
      const draft = await this.model.generate(question, sources);
      await record(stage, 'succeeded', { draft: assessmentTraceData(draft) });

      stage = 'validation';
      await record(stage, 'started', {});
      const assessment = validateAssessmentDraft(draft, sources);
      await record(stage, 'succeeded', {
        checks: ['assessment_shape', 'verdict_evidence_rules', 'exact_quote_membership'], assessment,
      });

      stage = 'persistence';
      await record(stage, 'started', {});
      const saved = await this.runs.saveOrGetAssessment({ ...assessment, runId: id, questionId }, attemptId);
      return { ...saved, sourceRevisionId: run.sourceRevisionId };
    } catch (error) {
      try {
        await record(stage, 'failed', { reason: 'Stage did not finish with a recorded result' });
      } catch {
        this.logger.warn('Unable to record assessment failure');
      }
      throw error;
    }
  }

  async getTrace(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const events = await this.runs.listEvents(id);
    return {
      runId: id,
      executionId: run.executionId,
      sourceRevisionId: run.sourceRevisionId,
      createdAt: run.createdAt,
      status: run.status === 'pending' && Date.now() - run.createdAt.getTime() >= 10 * 60 * 1000
        ? 'timed_out' : run.status,
      events,
    };
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
    return {
      runId: id,
      sourceRevisionId: run.sourceRevisionId,
      status,
      assessments,
      implementationPath: run.implementationPath,
    };
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
