import type { ConfigSlice } from '../../core';

export const CONFIG_REGISTRY_TOKEN = Symbol.for('@app/config/registry');

/** @returns The Nest provider token for one slice. */
export function getConfigToken<T>(slice: ConfigSlice<T>): string {
  return `@app/config/${slice.name}`;
}
