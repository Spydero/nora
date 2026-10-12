import { Controller, Get } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CurrentPrincipal, Roles } from '../auth/decorators.js';
import { MemoryService } from '../memory/memory.service.js';

@Controller('memory')
@Roles('PATIENT')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  /** What Nora will take into account in the next check, with links to correct each record. */
  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal) {
    return { items: await this.memory.forPatient(principal.tenantId, principal.userId) };
  }
}
