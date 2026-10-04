import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { WaitStatus } from './WaitStatus';

/**
 * Checks the session, then renders the top bar and the nested route. Redirects to /login when there is no session.
 * @returns A loading message until the session is confirmed, then the layout.
 */
export function Shell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<{ user: { email: string } }>('/api/auth/session')
      .then((session) => setEmail(session.user.email))
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setReady(true));
  }, [navigate]);

  /** Ends the session on the API and goes to /login. A network failure keeps the analyst on the page. */
  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiError)) return;
    }
    navigate('/login');
  }

  if (!ready || !email) return <WaitStatus>Checking session…</WaitStatus>;

  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
        <strong className="brand">
          <span className="mark" aria-hidden="true" />
          Incident assistant
        </strong>
        <nav>
          <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/new">New</NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/history">History</NavLink>
        </nav>
        <div className="session">
          <span>{email}</span>
          <button className="button-quiet" type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
        </div>
      </header>
      <main id="content">
        <Outlet />
      </main>
    </>
  );
}
