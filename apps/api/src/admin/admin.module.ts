import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReviewModule } from '../review/review.module.js';
import { AdminService, auditQuerySchema, memberUpdateSchema, providerStatusSchema, toggleSchema } from './admin.service.js';

@Controller('admin')
@Roles('TENANT_ADMIN')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.admin.overview(principal);
  }

  @Put('capabilities/:key')
  setCapability(@CurrentPrincipal() principal: AuthPrincipal, @Param('key') key: string, @Body(new ZodValidationPipe(toggleSchema)) body: z.infer<typeof toggleSchema>) {
    return this.admin.setCapability(principal, key, body);
  }

  @Get('members')
  members(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.admin.members(principal);
  }

  @Patch('members/:id')
  updateMember(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(memberUpdateSchema)) body: z.infer<typeof memberUpdateSchema>,
  ) {
    return this.admin.updateMember(principal, id, body);
  }

  @Get('audit')
  audit(@CurrentPrincipal() principal: AuthPrincipal, @Query(new ZodValidationPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    return this.admin.auditLog(principal, query.limit);
  }

  @Get('providers')
  providers(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.admin.providers(principal);
  }

  @Patch('providers/:id')
  setProviderStatus(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(providerStatusSchema)) body: z.infer<typeof providerStatusSchema>,
  ) {
    return this.admin.setProviderStatus(principal, id, body);
  }
}

@Controller('platform')
@Roles('PLATFORM_OPERATOR')
export class PlatformController {
  constructor(private readonly admin: AdminService) {}

  @Get('flags')
  flags() {
    return this.admin.platformFlags();
  }

  @Put('flags/:key')
  setFlag(@CurrentPrincipal() principal: AuthPrincipal, @Param('key') key: string, @Body(new ZodValidationPipe(toggleSchema)) body: z.infer<typeof toggleSchema>) {
    return this.admin.setPlatformFlag(principal, key, body);
  }
}

@Controller('content')
@Roles('CLINICAL_CONTENT_EDITOR', 'CLINICAL_APPROVER')
export class ContentController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  content(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.admin.content(principal);
  }
}

@Module({ imports: [ReviewModule], controllers: [AdminController, PlatformController, ContentController], providers: [AdminService] })
export class AdminModule {}
