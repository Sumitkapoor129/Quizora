import { createBrowserRouter, Navigate, useLocation, type RouteObject } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { useAuth } from '@/hooks/useAuth';
import AdminDashboard from '@/pages/admin/Dashboard';
import Login from '@/pages/auth/Login';
import Register from '@/pages/auth/Register';
import NotFound from '@/pages/NotFound';
import Placeholder from '@/pages/Placeholder';
import StudentDashboard from '@/pages/student/Dashboard';
import type { Role } from '@/types';

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
}

function ProtectedRoute({ role }: { role: Role }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user.role !== role) {
    return <Navigate to="/" replace />;
  }
  return <AppLayout />;
}

export const routes: RouteObject[] = [
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/student',
    element: <ProtectedRoute role="student" />,
    children: [
      { index: true, element: <StudentDashboard /> },
      {
        path: 'results',
        element: <Placeholder title="My Results" description="Scores and marked answers for tests you've taken." />,
      },
    ],
  },
  {
    path: '/admin',
    element: <ProtectedRoute role="admin" />,
    children: [
      { index: true, element: <AdminDashboard /> },
      {
        path: 'tests',
        element: <Placeholder title="Tests" description="Create, publish, and manage tests." />,
      },
      {
        path: 'attempts',
        element: <Placeholder title="Attempts" description="Review student submissions in detail." />,
      },
      {
        path: 'analytics',
        element: <Placeholder title="Analytics" description="Performance trends across tests and students." />,
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