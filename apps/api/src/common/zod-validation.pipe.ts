import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from './app.exception.js';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Some fields need attention.', false, {
        fields,
      });
    }
    return result.data;
  }
}
