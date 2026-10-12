import { Global, Module } from '@nestjs/common';
import { AiService } from './ai/ai.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';

@Global()
@Module({
  providers: [PrismaService, RedisService, AiService],
  exports: [PrismaService, RedisService, AiService],
})
export class InfraModule {}
