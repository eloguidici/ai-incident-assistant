import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

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

describe('LoginPage password visibility', () => {
  beforeEach(() => {
    navigate.mockReset();
    apiMock.mockReset();
  });

  it('starts masked and preserves the value while toggling without submitting', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    await user.type(input, 'Demo1234$');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('Demo1234$');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('Demo1234$');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('supports Tab, Enter and Space without submitting the form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await user.type(screen.getByLabelText('Password'), 'Demo1234$');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.keyboard(' ');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('submits unchanged credentials after revealing the password', async () => {
    apiMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await user.type(screen.getByLabelText('Password'), 'Demo1234$');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'demo1@demo.com', password: 'Demo1234$' }),
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/history'));
  });

  it('resets visibility and the password when the login form is remounted', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await user.type(screen.getByLabelText('Password'), 'Demo1234$');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    unmount();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
