import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './store/auth-store';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './app/login/LoginPage';
import { GridPage } from './app/grid/GridPage';
import { ApprovalsPage } from './app/approvals/ApprovalsPage';
import { SettingsPage } from './app/settings/SettingsPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/grid" element={<GridPage />} />
            <Route
              path="/approvals"
              element={
                <ProtectedRoute roles={['SUPER_ADMIN']}>
                  <ApprovalsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute roles={['SUPER_ADMIN']}>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/drive-browser"
              element={
                <ProtectedRoute roles={['SUPER_ADMIN']}>
                  <div className="p-8">
                    <h1 className="text-xl font-semibold">Drive Browser</h1>
                    <p className="mt-2 text-sm text-gray-500">Scaffolded route — implementation pending.</p>
                  </div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/grid" replace />} />
            <Route path="*" element={<Navigate to="/grid" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

