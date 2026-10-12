import { Module } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { ConsentModule } from '../consent/consent.module.js';
import { AssessmentWorker } from './assessment.worker.js';
import { CaseStore } from './case-store.js';
import { ChecksController } from './checks.controller.js';
import { ChecksService } from './checks.service.js';

@Module({
  imports: [ConsentModule],
  controllers: [ChecksController],
  providers: [AiService, CaseStore, ChecksService, AssessmentWorker],
})
export class ChecksModule {}
