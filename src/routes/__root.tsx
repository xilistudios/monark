import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useAutoLock } from '../hooks/useAutoLock';

function RootComponent() {
  useAutoLock();
  return <Outlet />;
}

export const Route = createRootRoute({
  component: RootComponent,
});
