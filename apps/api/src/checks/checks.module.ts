import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module.js';
import { MemoryService } from '../memory/memory.service.js';
import { AssessmentWorker } from './assessment.worker.js';
import { CaseStore } from './case-store.js';
import { ChecksController } from './checks.controller.js';
import { ChecksService } from './checks.service.js';
import { MemoryController } from './memory.controller.js';

@Module({
  imports: [ConsentModule],
  controllers: [MemoryController, ChecksController],
  providers: [CaseStore, ChecksService, AssessmentWorker, MemoryService],
  exports: [CaseStore],
})
export class ChecksModule {}
