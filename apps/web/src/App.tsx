import { createBrowserRouter, createMemoryRouter, Navigate, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell.tsx';
import { Button, Notice, Splash } from './components/ui.tsx';
import { ApiError, useMe } from './lib/api.ts';
import { config } from './lib/config.ts';
import { PENDING_MODULES } from './lib/modules.ts';
import { signOut, useSession } from './lib/session.tsx';
import { WorkspaceProvider } from './lib/workspace.tsx';
import { About, ModuleToCome, NotFound, NoWorkspace } from './pages/misc.tsx';
import { Properties } from './pages/Properties.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { Today } from './pages/Today.tsx';
import { WorkspacePage } from './pages/WorkspacePage.tsx';

/** Signed in, known to the API, and a member of at least one operator. */
function Gate() {
  const { session, loading } = useSession();
  const me = useMe();

  if (loading) return <Splash>Loading</Splash>;
  if (!session) return <Navigate to="/sign-in" replace />;
  if (me.isPending) return <Splash>Opening your workspace</Splash>;
  if (me.error) {
    return (
      <Splash>
        <div className="flex max-w-[420px] flex-col gap-4">
          <Notice tone="urgent">
            {me.error instanceof ApiError ? me.error.message : 'Something went wrong.'}
          </Notice>
          <div className="flex gap-3">
            <Button onClick={() => void me.refetch()}>Try again</Button>
            <Button variant="quiet" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </Splash>
    );
  }
  if (me.data.memberships.length === 0) return <NoWorkspace />;
  return (
    <WorkspaceProvider memberships={me.data.memberships}>
      <AppShell />
    </WorkspaceProvider>
  );
}

const routes = [
  { path: '/sign-in', element: <SignIn /> },
  {
    path: '/',
    element: <Gate />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: 'today', element: <Today /> },
      { path: 'properties', element: <Properties /> },
      { path: 'workspace', element: <WorkspacePage /> },
      { path: 'about', element: <About /> },
      ...PENDING_MODULES.map((module) => ({ path: module.path, element: <ModuleToCome module={module} /> })),
      { path: '*', element: <NotFound /> },
    ],
  },
];

// The demo keeps navigation in memory so it works anywhere it is hosted, including inside a preview frame.
const router = config.demo
  ? createMemoryRouter(routes, { initialEntries: ['/today'] })
  : createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
