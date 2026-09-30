import { UserEntity } from '../entities/user.entity';

/** Persistence port for analyst accounts. */
export interface UserRepository {
  /**
   * @param email Stored email, compared case-sensitively after caller normalizes.
   * @returns The row, or null when no account exists.
   */
  findByEmail(email: string): Promise<UserEntity | null>;

  /**
   * @param email New analyst email.
   * @param passwordHash Bcrypt hash; plain passwords never reach this layer.
   */
  insert(email: string, passwordHash: string): Promise<void>;

  /** @returns True when an account already exists for the email. */
  existsByEmail(email: string): Promise<boolean>;
}
