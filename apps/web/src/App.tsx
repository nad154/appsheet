import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './store/auth-store';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './app/login/LoginPage';
import { GridPage } from './app/grid/GridPage';
import { SettingsPage } from './app/settings/SettingsPage';
// Removed: DriveBrowserPage (moved to UNUSED_DRIVE.md)
import { DashboardPage } from './app/dashboard/DashboardPage';
import { AccountPage } from './app/account/AccountPage';

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
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route
              path="/settings"
              element={
                <ProtectedRoute roles={['SUPER_ADMIN']}>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            {/* Removed: DriveBrowserPage route (moved to UNUSED_DRIVE.md) */}
            <Route path="/" element={<Navigate to="/grid" replace />} />
            <Route path="*" element={<Navigate to="/grid" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

