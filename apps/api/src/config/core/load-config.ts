import type { ConfigSlice, ConfigSource } from './config-slice';
import { ConfigValidationError } from './config-errors';
import { ConfigRegistry } from './config-registry';

export interface LoadConfigOptions {
  source?: ConfigSource;
  slices: readonly ConfigSlice<unknown>[];
  allowUnknown?: boolean;
  abortEarly?: boolean;
}

/**
 * Validates each slice against the environment and stores the mapped settings.
 * @param options.source Defaults to `process.env`. Unknown keys are allowed so slices can share one environment.
 * @throws ConfigValidationError on the first invalid slice. Duplicate slice names throw before validation.
 */
export function loadConfig(options: LoadConfigOptions): ConfigRegistry {
  const source = options.source ?? process.env;
  const registry = new ConfigRegistry();
  const names = new Set<string>();

  for (const slice of options.slices) {
    if (names.has(slice.name)) {
      throw new Error(`Duplicate config slice name: ${slice.name}`);
    }

    names.add(slice.name);

    const validation = slice.schema.validate(source, {
      abortEarly: options.abortEarly ?? false,
      allowUnknown: options.allowUnknown ?? true,
      convert: true,
    });

    if (validation.error) {
      throw new ConfigValidationError(
        slice.name,
        validation.error.message,
        validation.error.details.map((detail) => detail.message),
      );
    }

    registry.set(slice, slice.map(validation.value as Record<string, unknown>));
  }

  return registry;
}
