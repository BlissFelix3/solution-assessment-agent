import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RunsRepository } from './runs.repository.js';

@Injectable()
export class DemoRunsService {
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
    return { runId: result.runId, sourceRevisionId: result.sourceRevisionId };
  }
}
