import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { NewAnalysisPage } from './NewAnalysisPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const apiMock = vi.fn();
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

describe('NewAnalysisPage', () => {
  beforeEach(() => {
    navigate.mockReset();
    apiMock.mockReset();
  });

  it('shows loading while the analysis is pending', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    apiMock.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <NewAnalysisPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId('source-input'), 'Service outage at 10:00 UTC.');
    await user.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(screen.getByText('Analyzing… this can take a few seconds.')).toBeInTheDocument();
    resolveCreate({ id: 'a1', status: 'completed' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/history/a1'));
  });

  it('keeps the incident text when submission is rejected', async () => {
    apiMock.mockRejectedValue(new ApiError('VALIDATION_ERROR', 'The text is too short.', 400));
    const user = userEvent.setup();
    const draft = 'Too brief';

    render(
      <MemoryRouter>
        <NewAnalysisPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId('source-input'), draft);
    await user.click(screen.getByRole('button', { name: 'Analyze' }));

    await screen.findByTestId('form-error');
    expect(screen.getByTestId('source-input')).toHaveValue(draft);
    expect(screen.getByTestId('form-error')).toHaveTextContent('The text is too short.');
  });
});
