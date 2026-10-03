import type { ReactNode } from 'react';

const entityClasses = {
  PERSON: 'person',
  EMAIL_ADDRESS: 'email',
  PHONE_NUMBER: 'phone',
};

/**
 * Colors literal backend PII tokens while preserving all text as safe React text nodes.
 * @param text Content to display, including any exact tokens with 32 lowercase hexadecimal characters.
 * @returns Inline text with colored tokens; malformed tokens remain plain text. Does not throw contract errors.
 */
export function PiiText({ text }: { text: string }) {
  const segments: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(/\[(PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g)) {
    const entityType = match[1] as keyof typeof entityClasses;
    segments.push(text.slice(cursor, match.index));
    segments.push(
      <span className={`pii-token pii-token--${entityClasses[entityType]}`} key={match.index}>
        {match[0]}
      </span>,
    );
    cursor = match.index + match[0].length;
  }

  segments.push(text.slice(cursor));
  return <span className="pii-text">{segments}</span>;
}
