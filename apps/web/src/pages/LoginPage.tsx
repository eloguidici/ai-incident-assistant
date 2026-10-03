import { FormEvent, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';

/**
 * Sign-in form. On success it goes to /history.
 * @returns The login form.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('demo1@demo.com');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Sends the credentials. The API sets the session cookies; errors are shown in the form.
   * @param event Form submit event. The default navigation is prevented.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      navigate('/history');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="narrow">
      <p className="eyebrow">Access</p>
      <h1>Sign in to analyze an incident</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <div className="password-field">
          <label htmlFor="login-password">Password</label>
          <div className="password-input">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              aria-controls="login-password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {error ? (
          <p className="error" role="alert" data-testid="login-error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
