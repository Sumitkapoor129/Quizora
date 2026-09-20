import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes';

export default function App() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}