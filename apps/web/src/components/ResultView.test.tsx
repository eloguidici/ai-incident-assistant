import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QuestionResult } from '../api';
import { ResultView } from './ResultView';

const person = '[PERSON_0123456789abcdef0123456789abcdef]';
const email = '[EMAIL_ADDRESS_0123456789abcdef0123456789abcdef]';
const phone = '[PHONE_NUMBER_0123456789abcdef0123456789abcdef]';
const answer: QuestionResult = {
  answer: `${person} reported the failure.`,
  summary: `Contact ${email}.`,
  category: `outage ${person}`,
  suggestedSeverity: `medium ${phone}`,
  evidence: [{ quote: `  ${person}\n<svg onload="alert(1)"> ${email}  `, note: `Reach ${phone}.` }],
  hypotheses: [{ statement: `${person} observed HTTP 503.`, confidence: `low ${email}` }],
  missingInformation: [`Confirmation from ${phone}.`],
  uncertainty: `Awaiting ${person}.`,
};

describe('ResultView PII rendering', () => {
  it('colors tokens in all result fields without mutating evidence or rendering HTML', () => {
    const beforeRender = JSON.stringify(answer);
    const { container } = render(<ResultView result={answer} />);
    expect(container.querySelectorAll('.pii-token')).toHaveLength(11);
    expect(container.querySelector('blockquote')?.textContent).toBe(answer.evidence[0].quote);
    expect(container.querySelector('svg')).toBeNull();
    expect(JSON.stringify(answer)).toBe(beforeRender);
    expect(container.textContent).toContain(answer.answer);
    expect(container.textContent).toContain(answer.summary);
    expect(container.textContent).toContain(answer.uncertainty);
  });

  it('preserves structured citations when the conversation hides the duplicated answer', () => {
    const { container } = render(<ResultView result={answer} hideAnswer testId="thread-result-detail" />);
    expect(screen.queryByRole('heading', { name: 'Answer' })).toBeNull();
    expect(screen.getByTestId('thread-result-detail')).toBeInTheDocument();
    expect(container.querySelector('blockquote')?.textContent).toBe(answer.evidence[0].quote);
    expect(container.querySelectorAll('.pii-token')).toHaveLength(10);
  });
});
