import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { getConfigToken } from '../config';
import { databaseConfig, type DatabaseConfig } from '../config/slices';
import { persistenceEntities } from './entities';
import { ANALYSIS_REPOSITORY, DATA_SOURCE, USER_REPOSITORY } from './repositories/tokens';
import { TypeOrmAnalysisRepository } from './repositories/typeorm/analysis.typeorm-repository';
import { TypeOrmUserRepository } from './repositories/typeorm/user.typeorm-repository';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [getConfigToken(databaseConfig)],
      useFactory: (database: DatabaseConfig) => ({
        type: 'postgres' as const,
        url: database.url,
        synchronize: false,
        entities: [...persistenceEntities],
        extra: { max: 10 },
      }),
    }),
    TypeOrmModule.forFeature([...persistenceEntities]),
  ],
  providers: [
    {
      provide: DATA_SOURCE,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => dataSource,
    },
    { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
    { provide: ANALYSIS_REPOSITORY, useClass: TypeOrmAnalysisRepository },
  ],
  exports: [DATA_SOURCE, USER_REPOSITORY, ANALYSIS_REPOSITORY, TypeOrmModule],
})
export class PersistenceModule {}
