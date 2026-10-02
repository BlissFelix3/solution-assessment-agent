import { Injectable } from '@nestjs/common';
import { AssessmentError } from '../../../domain/errors.js';
import type { WorkflowStarter } from '../../../application/ports/workflow-starter.js';

@Injectable()
export class N8nWorkflowStarter implements WorkflowStarter {
  hourlyLimit(): number | undefined {
    const limit = Number(process.env.DEMO_RUNS_PER_HOUR);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !process.env.N8N_START_WEBHOOK_URL ||
      !process.env.N8N_START_TOKEN ||
      !process.env.INTERNAL_API_TOKEN
    ) {
      return undefined;
    }
    return limit;
  }

  async start(questions: string[] | undefined) {
    const webhookUrl = process.env.N8N_START_WEBHOOK_URL;
    const token = process.env.N8N_START_TOKEN;
    if (!webhookUrl || !token) {
      throw new AssessmentError('unavailable', 'Demo start is not configured');
    }
    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'X-Demo-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(questions === undefined ? {} : { requirements: questions }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AssessmentError('unavailable', 'Demo start is unavailable');
    }
    if (response.status !== 202) {
      throw new AssessmentError('unavailable', 'Demo start is unavailable');
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new AssessmentError('unavailable', 'Demo start returned an invalid response');
    }
    if (
      result === null ||
      typeof result !== 'object' ||
      !('runId' in result) ||
      typeof result.runId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.runId) ||
      !('sourceRevisionId' in result) ||
      typeof result.sourceRevisionId !== 'string' ||
      result.sourceRevisionId.length === 0
    ) {
      throw new AssessmentError('unavailable', 'Demo start returned an invalid response');
    }
    return { runId: result.runId, sourceRevisionId: result.sourceRevisionId };
  }
}
