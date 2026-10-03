import { parseCollection, parseRetrievalMode } from '../domain/collections.js';
import { AssessmentError } from '../domain/errors.js';
import { parseRequirements } from '../domain/requirements.js';
import type { RunStore } from './ports/run-store.js';
import type { WorkflowStarter } from './ports/workflow-starter.js';

export class DemoRunsService {
  constructor(
    private readonly runs: RunStore,
    private readonly workflow: WorkflowStarter,
    private readonly warn: (message: string) => void,
  ) {}

  async start(input: unknown = undefined, collection: unknown = undefined, mode: unknown = undefined) {
    const requirements = parseRequirements(input);
    const options = { collectionId: parseCollection(collection), retrievalMode: parseRetrievalMode(mode) };
    const maxPerHour = this.workflow.hourlyLimit();
    if (maxPerHour === undefined) {
      throw new AssessmentError('unavailable', 'Demo start is not configured');
    }
    if (!(await this.runs.admitDemoStart(maxPerHour))) {
      throw new AssessmentError('capacity', 'Demo capacity reached; try again later');
    }
    const result = await this.workflow.start(
      input === undefined ? undefined : requirements.map((item) => item.question),
      options,
    );
    try {
      await this.runs.appendEvent(result.runId, {
        stage: 'webhook',
        status: 'succeeded',
        questionId: null,
        attemptId: null,
        data: {
          method: 'POST',
          path: '/webhook/solution-assessments',
          responseStatus: 202,
          authentication: 'Header credential',
          admission: 'Accepted within the global hourly limit',
        },
      });
    } catch {
      // The workflow already started; preserve its identity even if tracing is unavailable.
      this.warn('Unable to record demo webhook acknowledgment');
    }
    return { runId: result.runId, sourceRevisionId: result.sourceRevisionId };
  }
}
