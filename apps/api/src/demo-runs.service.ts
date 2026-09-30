import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RunsRepository } from './runs.repository.js';

@Injectable()
export class DemoRunsService {
  private readonly logger = new Logger(DemoRunsService.name);

  constructor(@Inject(RunsRepository) private readonly runs: RunsRepository) {}

  async start() {
    const maxPerHour = Number(process.env.DEMO_RUNS_PER_HOUR);
    const webhookUrl = process.env.N8N_START_WEBHOOK_URL;
    const token = process.env.N8N_START_TOKEN;
    if (
      !Number.isSafeInteger(maxPerHour) || maxPerHour < 1 ||
      !webhookUrl || !token || !process.env.INTERNAL_API_TOKEN
    ) {
      throw new ServiceUnavailableException('Demo start is not configured');
    }

    if (!await this.runs.admitDemoStart(maxPerHour)) {
      throw new HttpException('Demo capacity reached; try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'X-Demo-Token': token },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('Demo start is unavailable');
    }
    if (response.status !== 202) {
      throw new ServiceUnavailableException('Demo start is unavailable');
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ServiceUnavailableException('Demo start returned an invalid response');
    }
    if (result === null || typeof result !== 'object' ||
      !('runId' in result) || typeof result.runId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.runId) ||
      !('sourceRevisionId' in result) || typeof result.sourceRevisionId !== 'string' ||
      result.sourceRevisionId.length === 0) {
      throw new ServiceUnavailableException('Demo start returned an invalid response');
    }
    try {
      await this.runs.appendEvent(result.runId, {
        stage: 'webhook', status: 'succeeded', questionId: null, attemptId: null,
        data: {
          method: 'POST', path: '/webhook/solution-assessments', responseStatus: 202,
          authentication: 'Header credential', admission: 'Accepted within the global hourly limit',
        },
      });
    } catch {
      // The workflow already started; preserve its identity even if tracing is unavailable.
      this.logger.warn('Unable to record demo webhook acknowledgment');
    }
    return { runId: result.runId, sourceRevisionId: result.sourceRevisionId };
  }
}
