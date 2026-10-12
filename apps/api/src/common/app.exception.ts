import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super({ code, message }, status);
  }
}
