import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected) {
      throw new ServiceUnavailableException('Internal API access is not configured');
    }

    const received = context.switchToHttp().getRequest<IncomingMessage>().headers['x-internal-token'];
    if (
      typeof received !== 'string' ||
      Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
