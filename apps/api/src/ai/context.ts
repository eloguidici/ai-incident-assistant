export type ContextMessage = { role: string; content: string };

/**
 * Keeps the newest history messages that fit next to the source text and the question.
 * Each kept message is truncated to 1000 characters.
 * @param source Original incident text. Always included.
 * @param history Previous messages, oldest first.
 * @param question New analyst question. Always included.
 * @param budget Maximum characters for the whole prompt context.
 * @returns The kept history, oldest first, and `rejected: true` when the source and question alone exceed the budget.
 */
export function selectContext(
  source: string,
  history: ContextMessage[],
  question: string,
  budget: number,
): { history: ContextMessage[]; rejected: boolean } {
  const overhead = 180;
  const base = source.length + question.length + overhead;
  if (base > budget) return { history: [], rejected: true };
  const kept: ContextMessage[] = [];
  let used = base;
  for (const message of [...history].reverse()) {
    const content = message.content.slice(0, 1000);
    const size = content.length + 16;
    if (used + size > budget) break;
    kept.push({ role: message.role, content });
    used += size;
  }
  kept.reverse();
  return { history: kept, rejected: false };
}
