import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { DetailPage } from './pages/DetailPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NewAnalysisPage } from './pages/NewAnalysisPage';

/**
 * Declares the routes. Everything except /login renders inside the authenticated Shell; unknown paths go to /history.
 * @returns The route tree.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route path="/new" element={<NewAnalysisPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:id" element={<DetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/history" replace />} />
    </Routes>
  );
}
