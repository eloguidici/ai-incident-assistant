import { createContext, useContext, type ReactNode } from 'react';

function privacyTokens(): RegExp {
  return /\[(PERSON|EMAIL_ADDRESS|PHONE_NUMBER)_[a-f0-9]{32}\]/g;
}

const privacyWords = {
  PERSON: 'Person',
  EMAIL_ADDRESS: 'Email',
  PHONE_NUMBER: 'Phone',
} as const;

const entityClasses = {
  PERSON: 'person',
  EMAIL_ADDRESS: 'email',
  PHONE_NUMBER: 'phone',
} as const;

/**
 * Maps each exact privacy token in reading order to a short label.
 * One token of a kind is "Person", "Email" or "Phone". A second distinct token of that kind becomes "Person 1" and "Person 2".
 * @param texts Protected strings in reading order. Earlier text decides which token is 1.
 * @returns Map from the exact token to the short label. The original value is not recovered.
 */
export function privacyDisplayNames(texts: readonly string[]): Map<string, string> {
  const seen: Record<keyof typeof privacyWords, string[]> = {
    PERSON: [],
    EMAIL_ADDRESS: [],
    PHONE_NUMBER: [],
  };
  for (const text of texts) {
    for (const match of text.matchAll(privacyTokens())) {
      const kind = match[1] as keyof typeof privacyWords;
      if (!seen[kind].includes(match[0])) seen[kind].push(match[0]);
    }
  }
  const names = new Map<string, string>();
  for (const kind of Object.keys(seen) as (keyof typeof privacyWords)[]) {
    const tokens = seen[kind];
    tokens.forEach((token, index) => {
      names.set(token, tokens.length > 1 ? `${privacyWords[kind]} ${index + 1}` : privacyWords[kind]);
    });
  }
  return names;
}

/**
 * Replaces exact privacy tokens with the short labels from {@link privacyDisplayNames}.
 * @param text Protected text. Malformed tokens stay unchanged.
 * @returns Visible text. The stored token is not included.
 */
export function displayedPrivacyText(text: string): string {
  return applyPrivacyNames(text, privacyDisplayNames([text]));
}

/**
 * Replaces exact privacy tokens with labels from a shared map.
 * @param text Protected text. A token missing from the map stays unchanged.
 * @param names Labels from {@link privacyDisplayNames}.
 * @returns Visible text.
 */
export function applyPrivacyNames(text: string, names: ReadonlyMap<string, string>): string {
  return text.replace(privacyTokens(), (token) => names.get(token) ?? token);
}

const PrivacyNamesContext = createContext<Map<string, string> | null>(null);

/**
 * Gives every privacy token under this tree one stable short label.
 * @param texts Protected strings in the same order they are rendered.
 * @param children Rendered analysis or history card.
 * @returns The children with a shared label map. The original values are not recovered.
 */
export function PrivacyLabelScope({ texts, children }: { texts: readonly string[]; children: ReactNode }) {
  return <PrivacyNamesContext.Provider value={privacyDisplayNames(texts)}>{children}</PrivacyNamesContext.Provider>;
}

/**
 * Shows a short privacy label in place of the stored token, as a React text node.
 * Inside {@link PrivacyLabelScope}, the same token keeps the same number across every field.
 * @param text Content to display, including any exact tokens with 32 lowercase hexadecimal characters.
 * @returns Inline text. The exact token stays on `data-privacy-token`. Malformed tokens remain plain text. Does not throw contract errors.
 */
export function PiiText({ text }: { text: string }) {
  const shared = useContext(PrivacyNamesContext);
  const local = privacyDisplayNames([text]);
  const names = shared ?? local;
  const segments: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(privacyTokens())) {
    const entityType = match[1] as keyof typeof entityClasses;
    segments.push(text.slice(cursor, match.index));
    segments.push(
      <span
        className={`pii-token pii-token--${entityClasses[entityType]}`}
        data-privacy-token={match[0]}
        key={match.index}
      >
        {names.get(match[0]) ?? local.get(match[0])}
      </span>,
    );
    cursor = match.index + match[0].length;
  }

  segments.push(text.slice(cursor));
  return <span className="pii-text">{segments}</span>;
}
