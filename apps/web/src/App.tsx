import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './store/auth-store';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './app/login/LoginPage';
import { GridPage } from './app/grid/GridPage';
import { ApprovalsPage } from './app/approvals/ApprovalsPage';
import { SettingsPage } from './app/settings/SettingsPage';
import { DriveBrowserPage } from './app/drive-browser/DriveBrowserPage';

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
                  <DriveBrowserPage />
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

