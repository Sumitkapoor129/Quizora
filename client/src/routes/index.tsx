import { createBrowserRouter, Navigate, useLocation, type RouteObject } from 'react-router-dom';
import type { ReactNode } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/hooks/useAuth';
import AccessDenied from '@/pages/AccessDenied';
import AdminDashboard from '@/pages/admin/Dashboard';
import AttemptDetail from '@/pages/admin/attempts/AttemptDetail';
import AttemptsList from '@/pages/admin/attempts/AttemptsList';
import TestBuilder from '@/pages/admin/tests/Builder';
import TestsList from '@/pages/admin/tests/List';
import Login from '@/pages/auth/Login';
import Register from '@/pages/auth/Register';
import ForgotPassword from '@/pages/auth/ForgotPassword';
import ResetPassword from '@/pages/auth/ResetPassword';
import NotFound from '@/pages/NotFound';
import Analytics from '@/pages/admin/analytics';
import ResourceList from '@/pages/admin/resources/ResourceList';
import StudentDashboard from '@/pages/student/Dashboard';
import ExamRunner from '@/pages/student/ExamRunner';
import MyTests from '@/pages/student/MyTests';
import Profile from '@/pages/student/Profile';
import Result from '@/pages/student/Result';
import Resources from '@/pages/student/Resources';
import TestInstructions from '@/pages/student/TestInstructions';
import Tests from '@/pages/student/Tests';
import type { Role } from '@/types';

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
}

function ProtectedRoute({ role }: { role: Role }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="route-loading" role="status" aria-label="Checking your session">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user.role !== role) {
    return <AccessDenied />;
  }
  return <AppLayout />;
}

/**
 * Role-gated route WITHOUT the app shell (no header/nav/session banner).
 * Used for the full-screen exam flow so candidates get a clean, focused
 * surface and the session-expiry banner can't cover the exam UI.
 */
function ProtectedExamRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="route-loading" role="status" aria-label="Checking your session">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user.role !== role) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}

export const routes: RouteObject[] = [
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/student',
    element: <ProtectedRoute role="student" />,
    children: [
      { index: true, element: <StudentDashboard /> },
      { path: 'profile', element: <Profile /> },
      { path: 'results', element: <MyTests /> },
      { path: 'tests', element: <Tests /> },
      { path: 'resources', element: <Resources /> },
    ],
  },
  // Exam flow: same role protection, no AppLayout chrome.
  {
    path: '/student/tests/:testId/instructions',
    element: (
      <ProtectedExamRoute role="student">
        <TestInstructions />
      </ProtectedExamRoute>
    ),
  },
  {
    path: '/student/tests/:testId/attempt/:attemptId',
    element: (
      <ProtectedExamRoute role="student">
        <ExamRunner />
      </ProtectedExamRoute>
    ),
  },
  {
    path: '/student/tests/:testId/result/:attemptId',
    element: (
      <ProtectedExamRoute role="student">
        <Result />
      </ProtectedExamRoute>
    ),
  },
  {
    path: '/admin',
    element: <ProtectedRoute role="admin" />,
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'tests', element: <TestsList /> },
      { path: 'tests/new', element: <TestBuilder /> },
      { path: 'tests/:id/edit', element: <TestBuilder /> },
      {
        path: 'attempts',
        element: <AttemptsList />,
      },
      {
        path: 'attempts/:attemptId',
        element: <AttemptDetail />,
      },
      {
        path: 'analytics',
        element: <Analytics />,
      },
      {
        path: 'resources',
        element: <ResourceList />,
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];

export const router = createBrowserRouter(routes, {
  future: {
    v7_relativeSplatPath: true,
  },
});