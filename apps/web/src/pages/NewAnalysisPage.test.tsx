import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { NewAnalysisPage } from './NewAnalysisPage';

const navigate = vi.fn();
const configuration = vi.hoisted(() => ({ sourceTextMax: 8000, questionMax: 1000,
  contentProtectionEnabled: true, personProtectionEnabled: true }));
vi.mock('../hooks/useContentLimits', () => ({ useContentLimits: () => ({ limits: configuration, error: null }) }));
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
    configuration.contentProtectionEnabled = true;
    configuration.personProtectionEnabled = true;
  });

  it.each([
    [true, false, 'Contact protection only: emails and phones. Names are not protected.', 'Protecting detected emails and phones and analyzing...'],
    [false, false, 'Content protection disabled', 'Analyzing'],
  ] as const)('declares operator coverage %s/%s while processing', async (enabled, persons, label, pending) => {
    configuration.contentProtectionEnabled = enabled;
    configuration.personProtectionEnabled = persons;
    let finish: (value: unknown) => void = () => undefined;
    apiMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<MemoryRouter><NewAnalysisPage /></MemoryRouter>);
    expect(screen.getByTestId('content-protection-mode')).toHaveTextContent(label);
    await user.type(screen.getByTestId('source-input'), 'Service outage at 10:00 UTC.');
    await user.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(screen.getByRole('status')).toHaveTextContent(pending);
    finish({ id: 'm1', status: 'completed' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/history/m1'));
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

    expect(screen.getByTestId('content-protection-mode')).toHaveTextContent('Content protection enabled');
    expect(screen.getByRole('status')).toHaveTextContent('Protecting detected personal data and analyzing...');
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
