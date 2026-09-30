import Joi from 'joi';
import { defineConfigSlice } from './core';

export interface AppConfig {
  port: number;
  webOrigin: string;
  trustProxy: boolean;
  retentionDays: number;
  e2eReset: boolean;
}

export interface DatabaseConfig {
  url: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtTtlSeconds: number;
  cookieSecure: boolean;
  seedDemo: boolean;
  allowSeedDemo: boolean;
  seedPassword: string;
  loginMaxAttempts: number;
}

export interface LlmConfig {
  provider: 'mock' | 'openai';
  apiKey: string;
  model: string;
  deadlineMs: number;
  attemptTimeoutMs: number;
  maxOutputTokens: number;
  contextCharBudget: number;
  sourceTextMax: number;
  questionMax: number;
  maxInflight: number;
  faultInjection: boolean;
}

export interface LimitsConfig {
  analysesPerHour: number;
  questionsPerHour: number;
}

const flag = Joi.boolean().default(false);

/** HTTP process, browser origin, retention, and the test reset switch. */
export const appConfig = defineConfigSlice<AppConfig>({
  name: 'app',
  schema: Joi.object({
    PORT: Joi.number().integer().min(1).max(65535).default(3000),
    WEB_ORIGIN: Joi.string().uri().required(),
    TRUST_PROXY: flag,
    RETENTION_DAYS: Joi.number().integer().min(1).max(3650).default(30),
    E2E_RESET: flag,
  }),
  map: (env) => ({
    port: env.PORT as number,
    webOrigin: env.WEB_ORIGIN as string,
    trustProxy: env.TRUST_PROXY as boolean,
    retentionDays: env.RETENTION_DAYS as number,
    e2eReset: env.E2E_RESET as boolean,
  }),
});

/** Postgres connection used by the API and the CLI. */
export const databaseConfig = defineConfigSlice<DatabaseConfig>({
  name: 'database',
  schema: Joi.object({
    DATABASE_URL: Joi.string()
      .pattern(/^postgres(ql)?:\/\//)
      .required()
      .messages({ 'string.pattern.base': 'DATABASE_URL must use the postgres:// scheme' }),
  }),
  map: (env) => ({
    url: env.DATABASE_URL as string,
  }),
});

/** Session cookie, demo seed, and login throttling. */
export const authConfig = defineConfigSlice<AuthConfig>({
  name: 'auth',
  schema: Joi.object({
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_TTL_SECONDS: Joi.number().integer().min(60).max(604800).default(28800),
    COOKIE_SECURE: flag,
    SEED_DEMO: flag,
    ALLOW_SEED_DEMO: flag,
    SEED_PASSWORD: Joi.string().min(8).default('local-demo-password'),
    LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(1).max(100).default(10),
  }),
  map: (env) => ({
    jwtSecret: env.JWT_SECRET as string,
    jwtTtlSeconds: env.JWT_TTL_SECONDS as number,
    cookieSecure: env.COOKIE_SECURE as boolean,
    seedDemo: env.SEED_DEMO as boolean,
    allowSeedDemo: env.ALLOW_SEED_DEMO as boolean,
    seedPassword: env.SEED_PASSWORD as string,
    loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS as number,
  }),
});

/** Model provider, deadlines, and the size of text the model is allowed to see. */
export const llmConfig = defineConfigSlice<LlmConfig>({
  name: 'llm',
  schema: Joi.object({
    LLM_PROVIDER: Joi.string().valid('mock', 'openai').required(),
    OPENAI_API_KEY: Joi.string().allow('').optional(),
    OPENAI_MODEL: Joi.string().min(1).default('gpt-4o-mini'),
    LLM_DEADLINE_MS: Joi.number().integer().min(500).max(120000).default(20000),
    LLM_ATTEMPT_TIMEOUT_MS: Joi.number().integer().min(200).max(120000).default(12000),
    LLM_MAX_OUTPUT_TOKENS: Joi.number().integer().min(256).max(16384).default(4096),
    CONTEXT_CHAR_BUDGET: Joi.number().integer().min(200).max(100000).default(12000),
    SOURCE_TEXT_MAX: Joi.number().integer().min(20).max(50000).default(8000),
    QUESTION_MAX: Joi.number().integer().min(1).max(8000).default(1000),
    MAX_INFLIGHT_LLM: Joi.number().integer().min(1).max(100).default(4),
    FAULT_INJECTION: flag,
  }).custom((env: Record<string, unknown>, helpers) => {
    if (env.LLM_PROVIDER === 'openai' && String(env.OPENAI_API_KEY ?? '').length < 10) {
      return helpers.message({ custom: 'OPENAI_API_KEY is required when LLM_PROVIDER=openai' });
    }
    if (Number(env.LLM_ATTEMPT_TIMEOUT_MS) > Number(env.LLM_DEADLINE_MS)) {
      return helpers.message({ custom: 'LLM_ATTEMPT_TIMEOUT_MS cannot exceed LLM_DEADLINE_MS' });
    }
    return env;
  }),
  map: (env) => ({
    provider: env.LLM_PROVIDER as LlmConfig['provider'],
    apiKey: (env.OPENAI_API_KEY as string | undefined) ?? '',
    model: env.OPENAI_MODEL as string,
    deadlineMs: env.LLM_DEADLINE_MS as number,
    attemptTimeoutMs: env.LLM_ATTEMPT_TIMEOUT_MS as number,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS as number,
    contextCharBudget: env.CONTEXT_CHAR_BUDGET as number,
    sourceTextMax: env.SOURCE_TEXT_MAX as number,
    questionMax: env.QUESTION_MAX as number,
    maxInflight: env.MAX_INFLIGHT_LLM as number,
    faultInjection: env.FAULT_INJECTION as boolean,
  }),
});

/** Hourly caps for analyses and follow-up questions. */
export const limitsConfig = defineConfigSlice<LimitsConfig>({
  name: 'limits',
  schema: Joi.object({
    RATE_LIMIT_ANALYSES_PER_HOUR: Joi.number().integer().min(1).max(1000).default(20),
    RATE_LIMIT_QUESTIONS_PER_HOUR: Joi.number().integer().min(1).max(2000).default(40),
  }),
  map: (env) => ({
    analysesPerHour: env.RATE_LIMIT_ANALYSES_PER_HOUR as number,
    questionsPerHour: env.RATE_LIMIT_QUESTIONS_PER_HOUR as number,
  }),
});

export const appSlices = [appConfig, databaseConfig, authConfig, llmConfig, limitsConfig] as const;
