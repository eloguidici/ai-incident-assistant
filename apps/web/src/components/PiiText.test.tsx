import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PiiText } from './PiiText';

const digest = '0123456789abcdef0123456789abcdef';

describe('PiiText', () => {
  it('preserves exact text, whitespace, repeated and adjacent tokens with colors per type', () => {
    const person = `[PERSON_${digest}]`;
    const email = `[EMAIL_ADDRESS_${digest}]`;
    const phone = `[PHONE_NUMBER_${digest}]`;
    const text = `  Report\n${person}${email}\t${phone}, ${person}.  `;
    const { container } = render(<PiiText text={text} />);

    expect(container.textContent).toBe(text);
    expect(Array.from(container.querySelectorAll('.pii-token'), (token) => token.textContent))
      .toEqual([person, email, phone, person]);
    expect(container.querySelectorAll('.pii-token--person')).toHaveLength(2);
    expect(container.querySelectorAll('.pii-token--email')).toHaveLength(1);
    expect(container.querySelectorAll('.pii-token--phone')).toHaveLength(1);
    expect(container.querySelector('[aria-label], [title]')).toBeNull();
  });

  it.each([
    '',
    'No detected entities. Ticket INC-2026 and HTTP 503.',
    `[PERSON_${digest.slice(1)}]`,
    `[PERSON_${digest}0]`,
    `[PERSON_${digest.toUpperCase()}]`,
    `[PERSON_${'g'.repeat(32)}]`,
    `[person_${digest}]`,
    `[EMAIL_${digest}]`,
    `[LOCATION_${digest}]`,
    `[PHONE_NUMBER_${digest}`,
    `PERSON_${digest}]`,
    `[PERSON_ ${digest}]`,
    '[PERSON_1]',
  ])('leaves unsupported or malformed text unchanged: %j', (text) => {
    const { container } = render(<PiiText text={text} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('.pii-token')).toBeNull();
  });

  it('renders hostile HTML, entities, scripts and links only as literal text', () => {
    const text = `<img src=x onerror="alert(1)"><script>alert(2)</script>&lt;b&gt;` +
      `<a href="javascript:alert(3)">[PERSON_${digest}]</a>`;
    const { container } = render(<PiiText text={text} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('img, script, a, b')).toBeNull();
    expect(container.querySelector('.pii-token--person')?.textContent).toBe(`[PERSON_${digest}]`);
  });

  it('updates tokens without carrying matches from previous renders', () => {
    const { container, rerender } = render(<PiiText text={`[PERSON_${digest}]`} />);
    rerender(<PiiText text={`[PHONE_NUMBER_${digest}]`} />);
    expect(container.querySelector('.pii-token--person')).toBeNull();
    expect(container.querySelector('.pii-token--phone')?.textContent).toBe(`[PHONE_NUMBER_${digest}]`);
    rerender(<PiiText text="Plain report" />);
    expect(container.textContent).toBe('Plain report');
    expect(container.querySelector('.pii-token')).toBeNull();
  });
});
