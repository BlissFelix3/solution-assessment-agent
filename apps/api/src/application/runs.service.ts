import { parseCollection, parseRetrievalMode } from '../domain/collections.js';
import { RetrievalService } from './retrieval.service.js';
import type { WorkflowReader } from './ports/workflow-reader.js';
import { randomUUID } from 'node:crypto';
import { instruction, maxOutputTokens, promptVersion, responseSchema, thinkingBudget } from './assessment.prompt.js';
import type { AssessmentGenerator } from './ports/assessment-generator.js';
import type { RunStore } from './ports/run-store.js';
import { AssessmentError } from '../domain/errors.js';
import { validateAssessmentDraft } from '../domain/assessment.js';
import { parseRequirements } from '../domain/requirements.js';
import { buildImplementationPath } from '../domain/implementation-path.js';
import { assessmentTraceData, type RunEvent } from '../domain/run-trace.js';

export class RunsService {
  constructor(
    private readonly runs: RunStore,
    private readonly model: AssessmentGenerator,
    private readonly warn: (message: string) => void,
    private readonly retrieval: RetrievalService,
    private readonly workflow: WorkflowReader,
  ) {}

  async create(
    executionId: unknown,
    requirements: unknown = undefined,
    collection: unknown = undefined,
    mode: unknown = undefined,
  ) {
    if (typeof executionId !== 'string' || !/^\d{1,20}$/.test(executionId)) {
      throw new AssessmentError('invalid_input', 'Expected an n8n execution ID');
    }
    const run = await this.runs.create(
      executionId, parseRequirements(requirements), parseCollection(collection), parseRetrievalMode(mode),
    );
    if (!run) {
      throw new AssessmentError('unavailable', 'Source documents are not ready');
    }
    return {
      runId: run.id,
      sourceRevisionId: run.sourceRevisionId,
      requirements: run.requirements,
    };
  }

  async complete(id: string) {
    if (!await this.runs.complete(id)) {
      if (!await this.runs.findRun(id)) {
        throw new AssessmentError('not_found', 'Run not found');
      }
      throw new AssessmentError('conflict', 'Run is incomplete or failed');
    }
    return { runId: id, status: 'completed' as const };
  }

  async createDossier(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new AssessmentError('not_found', 'Run not found');
    }
    if (run.implementationPath) {
      return {
        runId: id,
        sourceRevisionId: run.sourceRevisionId,
        implementationPath: run.implementationPath,
      };
    }
    const assessments = await this.runs.listAssessments(id);
    if (
      assessments.length !== run.requirements.length ||
      run.requirements.some(
        (item) => !assessments.some((assessment) => assessment.questionId === item.id),
      )
    ) {
      throw new AssessmentError('conflict', 'Run needs all submitted assessments before its dossier');
    }
    const path = buildImplementationPath(assessments, run.requirements, run.collectionId);
    const saved = await this.runs.saveImplementationPath(id, path);
    if (!saved) {
      throw new AssessmentError('conflict', 'Run cannot save its dossier');
    }
    return { runId: id, sourceRevisionId: run.sourceRevisionId, implementationPath: saved };
  }

  async failExecution(executionId: string) {
    if (!/^\d{1,20}$/.test(executionId)) {
      throw new AssessmentError('invalid_input', 'Expected an n8n execution ID');
    }
    await this.runs.failExecution(executionId);
  }

  async search(id: string, questionId: unknown, mode: unknown) {
    if (typeof questionId !== 'string' || mode !== 'keyword') {
      throw new AssessmentError('invalid_input', 'Expected a questionId and mode=keyword');
    }

    const run = await this.runs.findRun(id);
    if (!run) {
      throw new AssessmentError('not_found', 'Run not found');
    }
    const question = run.requirements.find((item) => item.id === questionId)?.question;
    if (!question) {
      throw new AssessmentError('invalid_input', 'Unknown questionId for this run');
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
      throw new AssessmentError('invalid_input', 'Expected a questionId');
    }
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new AssessmentError('not_found', 'Run not found');
    }
    const question = run.requirements.find((item) => item.id === questionId)?.question;
    if (!question) {
      throw new AssessmentError('invalid_input', 'Unknown questionId for this run');
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
        question,
        mode: run.retrievalMode,
        sourceRevisionId: run.sourceRevisionId,
        limit: 5,
      });
      const result = await this.retrieval.retrieve(run.sourceRevisionId, question, run.retrievalMode);
      const candidates = result.context;
      await record(stage, 'succeeded', { ...result, count: candidates.length });

      stage = 'generation';
      const sources = candidates.map(({ path, content }) => ({ path, content }));
      await record(stage, 'started', {
        promptVersion,
        instruction,
        responseSchema,
        question,
        sources,
        maxOutputTokens,
      });
      const draft = await this.model.generate(question, sources, async (event) => {
        await record('generation', event.status, {
          provider: event.provider,
          model: event.model,
          ...(event.status === 'started' ? {
            promptVersion, instruction, responseSchema, question, sources, maxOutputTokens,
            ...(event.provider === 'gemini' ? { thinkingBudget } : { reasoningEffort: 'low' }),
          } : { reason: event.reason }),
        });
      });
      await record(stage, 'succeeded', { draft: assessmentTraceData(draft) });

      stage = 'validation';
      await record(stage, 'started', {});
      const assessment = validateAssessmentDraft(draft, sources);
      await record(stage, 'succeeded', {
        checks: ['assessment_shape', 'verdict_evidence_rules', 'exact_quote_membership'],
        assessment,
      });

      stage = 'persistence';
      await record(stage, 'started', {});
      const saved = await this.runs.saveOrGetAssessment(
        { ...assessment, runId: id, questionId },
        attemptId,
      );
      return { ...saved, sourceRevisionId: run.sourceRevisionId };
    } catch (error) {
      try {
        await record(stage, 'failed', { reason: 'Stage did not finish with a recorded result' });
      } catch {
        this.warn('Unable to record assessment failure');
      }
      throw error;
    }
  }

  async getTrace(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new AssessmentError('not_found', 'Run not found');
    }
    const events = await this.runs.listEvents(id);
    return {
      collectionId: run.collectionId,
      retrievalMode: run.retrievalMode,
      runId: id,
      executionId: run.executionId,
      requirements: run.requirements,
      sourceRevisionId: run.sourceRevisionId,
      createdAt: run.createdAt,
      status:
        run.status === 'pending' && Date.now() - run.createdAt.getTime() >= 10 * 60 * 1000
          ? 'timed_out'
          : run.status,
      events,
    };
  }

  async listAssessments(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new AssessmentError('not_found', 'Run not found');
    }
    const assessments = await this.runs.listAssessments(id);
    const status =
      run.status === 'pending' && Date.now() - run.createdAt.getTime() >= 10 * 60 * 1000
        ? 'timed_out'
        : run.status;
    return {
      runId: id,
      sourceRevisionId: run.sourceRevisionId,
      status,
      assessments,
      requirements: run.requirements,
      implementationPath: run.implementationPath,
    };
  }

  async getWorkflow(id: string) {
    const run = await this.runs.findRun(id);
    if (!run) throw new AssessmentError('not_found', 'Run not found');
    return run.executionId ? this.workflow.read(run.executionId) : null;
  }

  async getSource(id: string, path: unknown) {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new AssessmentError('invalid_input', 'Expected a source path');
    }
    const run = await this.runs.findRun(id);
    if (!run) {
      throw new AssessmentError('not_found', 'Run not found');
    }
    const sourceRevisionId = run.sourceRevisionId;
    const source = await this.runs.findSource(sourceRevisionId, path);
    if (!source) {
      throw new AssessmentError('not_found', 'Source not found in run revision');
    }
    return { sourceRevisionId, ...source };
  }
}
