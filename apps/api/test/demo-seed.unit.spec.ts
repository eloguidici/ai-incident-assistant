import bcrypt from 'bcryptjs';
import type { AuthConfig } from '../src/config/slices';
import type { UserEntity } from '../src/db/entities/user.entity';
import type { UserRepository } from '../src/db/repositories/user.repository';
import { DEMO_EMAILS, seedDemoUsers } from '../src/db/seed';

const demoSettings: AuthConfig = {
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long',
  jwtTtlSeconds: 28800,
  cookieSecure: false,
  seedDemo: true,
  allowSeedDemo: true,
  seedPassword: 'Demo1234$',
  loginMaxAttempts: 10,
};
const localDatabaseUrl = 'postgres://app:app@localhost:5432/incident_assistant';

describe('Local demo account bootstrap', () => {
  let storedUsers: Map<string, UserEntity>;
  let users: jest.Mocked<UserRepository>;

  beforeEach(() => {
    storedUsers = new Map();
    users = {
      findByEmail: jest.fn(async (email: string) => storedUsers.get(email) ?? null),
      existsByEmail: jest.fn(async (email: string) => storedUsers.has(email)),
      insert: jest.fn(async (email: string, passwordHash: string) => {
        storedUsers.set(email, {
          id: `demo-user-${storedUsers.size + 1}`,
          email,
          passwordHash,
          createdAt: new Date('2026-10-03T00:00:00Z'),
        });
      }),
    };
  });

  it('creates exactly the requested accounts with hashed passwords including the literal dollar', async () => {
    expect(DEMO_EMAILS).toEqual(['demo1@demo.com', 'demo2@demo.com']);
    await seedDemoUsers(users, demoSettings, localDatabaseUrl);
    expect([...storedUsers.keys()]).toEqual([...DEMO_EMAILS]);
    for (const user of storedUsers.values()) {
      expect(user.passwordHash).not.toBe(demoSettings.seedPassword);
      expect(await bcrypt.compare('Demo1234$', user.passwordHash)).toBe(true);
      expect(await bcrypt.compare('Demo1234', user.passwordHash)).toBe(false);
    }
  });

  it('does not duplicate or overwrite existing accounts on another startup', async () => {
    await seedDemoUsers(users, demoSettings, localDatabaseUrl);
    const initialUsers = [...storedUsers.values()];
    await seedDemoUsers(users, { ...demoSettings, seedPassword: 'different-demo-password' }, localDatabaseUrl);
    expect(users.insert).toHaveBeenCalledTimes(2);
    expect([...storedUsers.values()]).toEqual(initialUsers);
  });

  it('rejects local demo seeding when the explicit authorization flag is disabled', async () => {
    await expect(
      seedDemoUsers(users, { ...demoSettings, allowSeedDemo: false }, localDatabaseUrl),
    ).rejects.toThrow('Seed rejected');
    expect(users.insert).not.toHaveBeenCalled();
  });

  it('does not seed an unrelated production database even with the demo flag enabled', async () => {
    await expect(
      seedDemoUsers(users, demoSettings, 'postgres://app:app@localhost:5432/production'),
    ).rejects.toThrow('Seed rejected');
    expect(users.insert).not.toHaveBeenCalled();
  });
});
