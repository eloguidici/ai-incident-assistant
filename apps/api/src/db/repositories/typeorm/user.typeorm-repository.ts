import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../entities/user.entity';
import type { UserRepository } from '../user.repository';

@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  /**
   * @param users TypeORM repository for the users table.
   */
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  /** @inheritdoc */
  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { email } });
  }

  /** @inheritdoc */
  async insert(email: string, passwordHash: string): Promise<void> {
    await this.users.insert({ email, passwordHash });
  }

  /** @inheritdoc */
  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.users.count({ where: { email } });
    return count > 0;
  }
}
