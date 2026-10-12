import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AuditModule } from './audit/audit.service.js';
import { AccessTokenGuard } from './auth/access-token.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { ChecksModule } from './checks/checks.module.js';
import { ConsentModule } from './consent/consent.module.js';
import { correlationIdMiddleware } from './common/correlation-id.middleware.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { validateEnv } from './config/env.js';
import { DirectoryModule } from './directory/directory.module.js';
import { HealthController } from './health/health.controller.js';
import { InfraModule } from './infra.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { ReviewModule } from './review/review.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env', '../../.env'], validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    InfraModule,
    AuditModule,
    AuthModule,
    ConsentModule,
    ProfileModule,
    PrivacyModule,
    ChecksModule,
    DirectoryModule,
    ReviewModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(correlationIdMiddleware).forRoutes('*path');
  }
}
