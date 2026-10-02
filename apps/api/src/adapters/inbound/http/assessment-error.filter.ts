import { Catch, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AssessmentError } from '../../../domain/errors.js';

const responses = {
  invalid_input: { statusCode: 400, error: 'Bad Request' },
  not_found: { statusCode: 404, error: 'Not Found' },
  conflict: { statusCode: 409, error: 'Conflict' },
  unavailable: { statusCode: 503, error: 'Service Unavailable' },
  capacity: { statusCode: 429, error: 'Too Many Requests' },
};

@Catch(AssessmentError)
export class AssessmentErrorFilter implements ExceptionFilter<AssessmentError> {
  constructor(@Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost) {}

  catch(error: AssessmentError, host: ArgumentsHost) {
    const response = responses[error.code];
    this.adapter.httpAdapter.reply(
      host.switchToHttp().getResponse<unknown>(),
      { ...response, message: error.message },
      response.statusCode,
    );
  }
}
