import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { appointmentSchema, appointmentUpdateSchema, DirectoryService, providerQuerySchema, referralSchema } from './directory.service.js';

const medicineQuerySchema = z.object({ q: z.string().trim().max(80).optional() });

@Controller('medicines')
export class MedicinesController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query(new ZodValidationPipe(medicineQuerySchema)) query: z.infer<typeof medicineQuerySchema>) {
    return this.directory.medicines(principal, query.q);
  }

  @Get(':slug')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('slug') slug: string) {
    return this.directory.medicine(principal, slug);
  }
}

@Controller('providers')
export class ProvidersController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query(new ZodValidationPipe(providerQuerySchema)) query: z.infer<typeof providerQuerySchema>) {
    return this.directory.providers(principal, query);
  }

  @Get('facets')
  facets(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.directory.providerFacets(principal);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.directory.provider(principal, id);
  }
}

@Controller()
@Roles('PATIENT')
export class CareController {
  constructor(private readonly directory: DirectoryService) {}

  @Post('referrals')
  refer(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(referralSchema)) body: z.infer<typeof referralSchema>) {
    return this.directory.createReferral(principal, body);
  }

  @Get('appointments')
  appointments(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.directory.appointments(principal);
  }

  @Post('appointments')
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(appointmentSchema)) body: z.infer<typeof appointmentSchema>) {
    return this.directory.createAppointment(principal, body);
  }

  @Patch('appointments/:id')
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appointmentUpdateSchema)) body: z.infer<typeof appointmentUpdateSchema>,
  ) {
    return this.directory.updateAppointment(principal, id, body);
  }
}

@Module({ controllers: [MedicinesController, ProvidersController, CareController], providers: [DirectoryService], exports: [DirectoryService] })
export class DirectoryModule {}
