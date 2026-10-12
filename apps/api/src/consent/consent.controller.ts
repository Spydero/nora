import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConsentService } from './consent.service.js';

const consentSchema = z.object({
  purpose: z.enum(['PROCESSING', 'CLINICIAN_SHARING', 'VOICE', 'ANALYTICS']),
  granted: z.boolean(),
});

@Controller('consents')
@Roles('PATIENT')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.consent.list(principal);
  }

  @Post()
  record(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(consentSchema)) body: z.infer<typeof consentSchema>) {
    return this.consent.record(principal, body.purpose, body.granted);
  }
}
