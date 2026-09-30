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
});
