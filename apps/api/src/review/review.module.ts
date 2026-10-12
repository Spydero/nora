import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { CaseStore } from '../checks/case-store.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { decisionSchema, reviewQuerySchema, ReviewService, versionSchema } from './review.service.js';

@Controller('review/tasks')
@Roles('CLINICIAN', 'CLINICAL_APPROVER', 'CARE_COORDINATOR')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query(new ZodValidationPipe(reviewQuerySchema)) query: z.infer<typeof reviewQuerySchema>) {
    return this.review.list(principal, query.status);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.get(principal, id);
  }

  @Post(':id/claim')
  @Roles('CLINICIAN', 'CLINICAL_APPROVER')
  claim(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(versionSchema)) body: z.infer<typeof versionSchema>) {
    return this.review.claim(principal, id, body.version);
  }

  @Post(':id/release')
  @Roles('CLINICIAN', 'CLINICAL_APPROVER')
  release(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(versionSchema)) body: z.infer<typeof versionSchema>) {
    return this.review.claim(principal, id, body.version, true);
  }

  @Post(':id/decision')
  @Roles('CLINICIAN', 'CLINICAL_APPROVER')
  decide(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.review.decide(principal, id, body);
  }
}

@Module({ controllers: [ReviewController], providers: [ReviewService, CaseStore], exports: [ReviewService] })
export class ReviewModule {}
