import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { type ProfileInput, profileSchema, ProfileService } from './profile.service.js';

@Controller('profile')
@Roles('PATIENT')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.profile.get(principal);
  }

  @Put()
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(profileSchema)) body: ProfileInput) {
    return this.profile.update(principal, body);
  }
}

@Module({ controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
