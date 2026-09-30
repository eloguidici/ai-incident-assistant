import { Global, Module } from '@nestjs/common';
import { AppLogger } from './app-logger';

/** Registers {@link AppLogger} for injection across feature modules. */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggingModule {}
