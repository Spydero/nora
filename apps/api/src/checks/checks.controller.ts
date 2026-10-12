import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ChecksService } from './checks.service.js';

const idempotencyKey = z.string().min(8).max(100);

const createSchema = z.object({ idempotencyKey, parentId: z.uuid().optional() });
const ackSchema = z.object({ done: z.boolean() });
const messageSchema = z.object({
  text: z.string().trim().min(1, 'Describe what you are experiencing').max(2000, 'Please keep this under 2000 characters'),
  idempotencyKey,
});
const answerSchema = z.object({
  questionId: z.string().min(1).max(100),
  inputVersion: z.number().int().min(0),
  value: z.union([z.enum(['yes', 'no', 'unsure']), z.number(), z.array(z.string().max(100)).max(20), z.null()]),
});
const eventsQuery = z.object({ after: z.string().regex(/^\d{1,19}$/).default('0') });

@Controller('checks')
@Roles('PATIENT')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.checks.create(principal, body.idempotencyKey, body.parentId);
  }

  @Post(':id/care-plan/:itemId')
  acknowledge(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(ackSchema)) body: z.infer<typeof ackSchema>,
  ) {
    return this.checks.acknowledge(principal, id, itemId.slice(0, 100), body.done);
  }

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.checks.list(principal);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.checks.view(principal, id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  message(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(messageSchema)) body: z.infer<typeof messageSchema>,
  ) {
    return this.checks.postMessage(principal, id, body.text, body.idempotencyKey);
  }

  @Post(':id/answers')
  @HttpCode(HttpStatus.ACCEPTED)
  answer(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(answerSchema)) body: z.infer<typeof answerSchema>,
  ) {
    return this.checks.answer(principal, id, body.questionId, body.inputVersion, body.value);
  }

  @Get(':id/events')
  events(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(eventsQuery)) query: z.infer<typeof eventsQuery>,
  ) {
    return this.checks.events(principal, id, BigInt(query.after));
  }
}
