import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.ping(),
    ]);
    const ok = database && redis;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' } };
  }
}
