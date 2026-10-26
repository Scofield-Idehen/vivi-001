import { useEffect, useMemo, useState } from 'react';
import { createBrowserRouter, createMemoryRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell.tsx';
import { ConsoleShell } from './components/ConsoleShell.tsx';
import { StartLoading } from './components/Spinner.tsx';
import { Button, Notice, Splash } from './components/ui.tsx';
import { ApiError, useMe } from './lib/api.ts';
import { config } from './lib/config.ts';
import { PENDING_MODULES } from './lib/modules.ts';
import { signOut, useSession } from './lib/session.tsx';
import { WorkspaceProvider, workspaceEntries } from './lib/workspace.tsx';
import { ChannelsPage } from './pages/ChannelsPage.tsx';
import { CalendarPage } from './pages/calendar/CalendarPage.tsx';
import { ConsoleOperatorDetail } from './pages/console/OperatorDetail.tsx';
import { ConsoleOperators } from './pages/console/Operators.tsx';
import { ConsoleOverview } from './pages/console/Overview.tsx';
import { ConsoleSupportLog } from './pages/console/SupportLog.tsx';
import { ConsoleSync } from './pages/console/Sync.tsx';
import { InboxPage } from './pages/inbox/InboxPage.tsx';
import { About, ModuleToCome, NotFound, NoWorkspace } from './pages/misc.tsx';
import { Properties } from './pages/Properties.tsx';
import { NewPropertyPanel } from './pages/properties/NewPropertyPanel.tsx';
import { PropertyPage } from './pages/properties/PropertyPage.tsx';
import { ReservationPage } from './pages/reservations/ReservationPage.tsx';
import { Reservations } from './pages/reservations/Reservations.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { StayPage } from './pages/StayPage.tsx';
import { Today, TodayList } from './pages/Today.tsx';
import { TasksPage } from './pages/tasks/TasksPage.tsx';
import { WorkspacePage } from './pages/WorkspacePage.tsx';

/**
 * The app's start stays on screen at least this long, so the mark and the turning ring settle
 * rather than flash when the answer comes back at once (as it does in the demo, and on a fast line).
 */
const START_MIN_MS = 1400;

function useStartHeld(): boolean {
  const [held, setHeld] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(false), START_MIN_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return held;
}

/** Signed in, known to the API, and either V-01 staff or able to open at least one workspace. */
function Gate() {
  const { session, loading } = useSession();
  const me = useMe();
  const entries = useMemo(() => (me.data ? workspaceEntries(me.data) : []), [me.data]);
  const held = useStartHeld();

  if (loading)
    return (
      <Splash>
        <StartLoading>Signing you in</StartLoading>
      </Splash>
    );
  if (!session) return <Navigate to="/sign-in" replace />;
  if (me.isPending || held)
    return (
      <Splash>
        <StartLoading>Opening your workspace</StartLoading>
      </Splash>
    );
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
  if (!me.data.platformRole && entries.length === 0) return <NoWorkspace />;
  return (
    <WorkspaceProvider entries={entries}>
      <Outlet />
    </WorkspaceProvider>
  );
}

/** V-01 staff start in the console; everyone else in their workspace. */
function Home() {
  const platformRole = useMe().data?.platformRole;
  return <Navigate to={platformRole ? '/console' : '/today'} replace />;
}

function StaffOnly() {
  const platformRole = useMe().data?.platformRole;
  if (!platformRole) return <Navigate to="/today" replace />;
  return <ConsoleShell />;
}

const routes = [
  { path: '/sign-in', element: <SignIn /> },
  // The guest's page for their stay: public, by the key in their link.
  { path: '/stay/:key', element: <StayPage /> },
  {
    path: '/',
    element: <Gate />,
    children: [
      { index: true, element: <Home /> },
      {
        path: 'console',
        element: <StaffOnly />,
        children: [
          { index: true, element: <ConsoleOverview /> },
          { path: 'operators', element: <ConsoleOperators /> },
          { path: 'operators/:orgId', element: <ConsoleOperatorDetail /> },
          { path: 'sync', element: <ConsoleSync /> },
          { path: 'support', element: <ConsoleSupportLog /> },
          { path: 'about', element: <About /> },
          { path: '*', element: <NotFound home="/console" /> },
        ],
      },
      {
        element: <AppShell />,
        children: [
          { path: 'today', element: <Today /> },
          { path: 'today/:list', element: <TodayList /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'reservations', element: <Reservations /> },
          { path: 'reservations/:id', element: <ReservationPage /> },
          {
            path: 'properties',
            element: <Properties />,
            children: [{ path: 'new', element: <NewPropertyPanel /> }],
          },
          { path: 'properties/:id', element: <PropertyPage /> },
          { path: 'inbox', element: <InboxPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'channels', element: <ChannelsPage /> },
          { path: 'workspace', element: <WorkspacePage /> },
          { path: 'about', element: <About /> },
          ...PENDING_MODULES.map((module) => ({
            path: module.path,
            element: <ModuleToCome module={module} />,
          })),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

// The demo keeps navigation in memory so it works anywhere it is hosted, including inside a preview frame.
const router = config.demo
  ? createMemoryRouter(routes, { initialEntries: ['/'] })
  : createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
