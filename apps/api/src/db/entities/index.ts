import { UserEntity } from './user.entity';
import { AnalysisEntity } from './analysis.entity';
import { MessageEntity } from './message.entity';
import { AiExecutionEntity } from './ai-execution.entity';
import { AuditEventEntity } from './audit-event.entity';

export { UserEntity, AnalysisEntity, MessageEntity, AiExecutionEntity, AuditEventEntity };

export const persistenceEntities = [
  UserEntity,
  AnalysisEntity,
  MessageEntity,
  AiExecutionEntity,
  AuditEventEntity,
];
