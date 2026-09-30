import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunStatus, type AnalysisDetail } from '../api';
import { DetailPage } from './DetailPage';

const apiMock = vi.fn();
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

function completedDetail(id: string, sourceText: string): AnalysisDetail {
  return {
    id,
    status: RunStatus.Completed,
    sourceText,
    result: {
      summary: `Summary for ${id}`,
      category: 'outage',
      suggestedSeverity: 'medium',
      evidence: [],
      hypotheses: [],
      missingInformation: [],
      uncertainty: 'Needs confirmation.',
    },
    errorCode: null,
    errorMessage: null,
    promptVersion: 'v1',
    provider: 'mock',
    model: 'mock-model',
    createdAt: '2026-09-30T12:00:00.000Z',
    expiresAt: '2026-10-30T12:00:00.000Z',
    messages: [],
    executions: [],
  };
}

function failedDetail(id: string): AnalysisDetail {
  return {
    ...completedDetail(id, 'failed run'),
    status: RunStatus.Failed,
    result: null,
    errorMessage: 'The model could not finish.',
  };
}

describe('DetailPage', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('restores persisted analysis content after load', async () => {
    apiMock.mockResolvedValue(completedDetail('keep-me', 'Persisted incident text.'));
    render(
      <MemoryRouter initialEntries={['/history/keep-me']}>
        <Routes>
          <Route path="/history/:id" element={<DetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('source-text')).toHaveTextContent('Persisted incident text.');
    expect(screen.getByTestId('analysis-result')).toBeInTheDocument();
  });

  it('shows failed analysis state with retry available', async () => {
    apiMock.mockResolvedValue(failedDetail('failed-id'));
    render(
      <MemoryRouter initialEntries={['/history/failed-id']}>
        <Routes>
          <Route path="/history/:id" element={<DetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('The model could not finish.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('does not apply a late response after navigating to another analysis', async () => {
    let resolveSlow: (value: AnalysisDetail) => void = () => undefined;
    const slowPromise = new Promise<AnalysisDetail>((resolve) => {
      resolveSlow = resolve;
    });

    apiMock.mockImplementation((path: string) => {
      if (path === '/api/analyses/slow') return slowPromise;
      if (path === '/api/analyses/fast') return Promise.resolve(completedDetail('fast', 'Fast analysis text.'));
      throw new Error(`Unexpected path ${path}`);
    });

    function NavigateToFast() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate('/history/fast');
      }, [navigate]);
      return (
        <Routes>
          <Route path="/history/:id" element={<DetailPage />} />
        </Routes>
      );
    }

    render(
      <MemoryRouter initialEntries={['/history/slow']}>
        <NavigateToFast />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('source-text')).toHaveTextContent('Fast analysis text.'));
    resolveSlow(completedDetail('slow', 'Stale slow analysis text.'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('source-text')).toHaveTextContent('Fast analysis text.');
  });
});
