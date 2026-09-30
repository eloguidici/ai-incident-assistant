/** Suffix on `correlationId` that triggers a mid-transaction rollback when `FAULT_INJECTION=true` (tests only). */
export const MidTransactionInjectSuffix = ':inject-mid-tx';

/**
 * Whether the current process should throw inside a persistence transaction (integration tests).
 * @param correlationId Audit correlation id for the commit.
 */
export function shouldInjectMidTransactionFailure(correlationId: string): boolean {
  return process.env.FAULT_INJECTION === 'true' && correlationId.endsWith(MidTransactionInjectSuffix);
}
