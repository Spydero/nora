import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';

@Global()
@Module({
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class InfraModule {}
