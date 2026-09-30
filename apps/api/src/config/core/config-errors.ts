/** Fail-fast error. The message names the slice and the invalid fields, never secret values. */
export class ConfigValidationError extends Error {
  /**
   * @param sliceName Slice whose schema rejected the environment.
   * @param message Joi summary for that slice.
   * @param details Individual schema messages.
   */
  constructor(
    public readonly sliceName: string,
    message: string,
    public readonly details: readonly string[] = [],
  ) {
    super(`Configuration error in slice "${sliceName}": ${message}`);
    this.name = 'ConfigValidationError';
  }
}

/** Thrown when code asks for a slice that was not passed to `loadConfig`. */
export class ConfigSliceNotLoadedError extends Error {
  /** @param sliceName Name that is missing from the registry. */
  constructor(sliceName: string) {
    super(`Configuration slice "${sliceName}" is not loaded.`);
    this.name = 'ConfigSliceNotLoadedError';
  }
}
