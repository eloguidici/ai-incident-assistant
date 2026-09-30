import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/exception-filter';
import { ReusableConfigModule } from './config';
import { envSearchRoots } from './config/env';
import { appSlices } from './config/slices';
import { PersistenceModule } from './db/persistence.module';
import { AnalysesModule } from './analyses/analyses.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { StartupService } from './startup.service';

@Module({
  imports: [
    ReusableConfigModule.register({
      slices: [...appSlices],
      envFiles: { searchRoots: envSearchRoots() },
    }),
    PersistenceModule,
    AuthModule,
    AnalysesModule,
  ],
  controllers: [HealthController],
  providers: [StartupService, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
