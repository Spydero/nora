import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from './app.exception.js';

const DEFAULT_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/** Consistent error envelope (PRD 7.4). Never echoes request bodies or clinical payloads. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let retryable = true;
    let details: unknown;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      retryable = exception.retryable;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = DEFAULT_CODES[status] ?? 'HTTP_ERROR';
      message = exception.message;
      retryable = status === HttpStatus.TOO_MANY_REQUESTS;
    } else {
      this.logger.error(
        { correlationId: req.correlationId, path: req.route?.path ?? req.path, method: req.method },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      error: {
        code,
        message,
        correlation_id: req.correlationId,
        retryable,
        ...(details ? { details } : {}),
      },
    });
  }
}
