import type Joi from 'joi';

export type ConfigSource = Record<string, string | undefined>;

export interface ConfigSlice<T> {
  readonly name: string;
  readonly schema: Joi.ObjectSchema;
  readonly map: (validated: Record<string, unknown>) => T;
}

/** Returns a named slice. The name is the key used to store and inject the mapped settings. */
export function defineConfigSlice<T>(slice: ConfigSlice<T>): ConfigSlice<T> {
  if (!slice.name.trim()) {
    throw new Error('Config slice name is required.');
  }

  return {
    ...slice,
    name: slice.name.trim(),
  };
}
