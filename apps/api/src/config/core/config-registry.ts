import type { ConfigSlice } from './config-slice';
import { ConfigSliceNotLoadedError } from './config-errors';

/** Typed lookup of loaded slices. Prefer `get(slice)` so the return type stays attached to the slice. */
export class ConfigRegistry {
  private readonly values = new Map<string, unknown>();

  /** Stores the mapped settings for one slice. */
  set<T>(slice: ConfigSlice<T>, value: T): void {
    this.values.set(slice.name, value);
  }

  /** @returns True when that slice was loaded. */
  has<T>(slice: ConfigSlice<T>): boolean {
    return this.values.has(slice.name);
  }

  /**
   * @param slice Slice reference used at registration.
   * @returns Mapped settings for that slice.
   * @throws ConfigSliceNotLoadedError when the slice was not registered.
   */
  get<T>(slice: ConfigSlice<T>): T {
    if (!this.values.has(slice.name)) {
      throw new ConfigSliceNotLoadedError(slice.name);
    }

    return this.values.get(slice.name) as T;
  }

  /**
   * @param name Slice name, for dynamic infrastructure.
   * @throws ConfigSliceNotLoadedError when no slice uses that name.
   */
  getByName<T = unknown>(name: string): T {
    if (!this.values.has(name)) {
      throw new ConfigSliceNotLoadedError(name);
    }

    return this.values.get(name) as T;
  }

  /** @returns Loaded slice names. */
  names(): string[] {
    return [...this.values.keys()];
  }
}
