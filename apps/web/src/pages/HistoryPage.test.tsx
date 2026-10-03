import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { HistoryPage } from './HistoryPage';

const apiMock = vi.fn();
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

describe('HistoryPage', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('shows loading before the list arrives', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Loading history…')).toBeInTheDocument();
  });

  it('shows the empty state when there are no analyses', async () => {
    apiMock.mockResolvedValue({ items: [], page: { limit: 20, offset: 0, total: 0 } });
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('empty-history')).toBeInTheDocument();
  });

  it('shows an error alert when history cannot be loaded', async () => {
    apiMock.mockRejectedValue(new ApiError('HTTP_ERROR', 'Session expired.', 401));
    render(
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired.');
  });

  it('colors literal tokens in history titles and previews while preserving links and hostile text', async () => {
    const person = '[PERSON_0123456789abcdef0123456789abcdef]';
    const email = '[EMAIL_ADDRESS_0123456789abcdef0123456789abcdef]';
    const phone = '[PHONE_NUMBER_0123456789abcdef0123456789abcdef]';
    const summary = `Report from ${person}`;
    const excerpt = `<img src=x onerror="alert(1)"> ${email}\n${phone} [PERSON_truncated`;
    apiMock.mockResolvedValue({
      items: [{ id: 'protected', summary, excerpt, status: 'COMPLETED', createdAt: '2026-10-02T12:00:00Z' }],
      page: { limit: 20, offset: 0, total: 1 },
    });
    const { container } = render(<MemoryRouter><HistoryPage /></MemoryRouter>);
    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/history/protected');
    expect(link.querySelector('strong')?.textContent).toBe(summary);
    expect(link.querySelector('.pii-token--person')?.textContent).toBe(person);
    expect(link.querySelector('.pii-token--email')?.textContent).toBe(email);
    expect(link.querySelector('.pii-token--phone')?.textContent).toBe(phone);
    expect(link.textContent).toContain(excerpt);
    expect(container.querySelector('img')).toBeNull();
    expect(link.querySelectorAll('.pii-token')).toHaveLength(3);
  });
});
