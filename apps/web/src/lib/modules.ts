/**
 * The module map from the design roadmap (page 12). Built modules have a page;
 * the rest show when they arrive, so the team can see the whole shape from day one.
 */
export interface ModuleEntry {
  path: string;
  label: string;
  built: boolean;
  design?: string;
  phase?: string;
  summary?: string;
}

export interface ModuleGroup {
  label: string;
  items: ModuleEntry[];
}

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    label: 'Run the day',
    items: [
      { path: 'today', label: 'Today', built: true },
      {
        path: 'calendar',
        label: 'Calendar',
        built: false,
        design: 'D1',
        phase: 'Phase 1',
        summary:
          'Every property by date: bookings, blocks, turnovers, prices, minimum stays and price limits.',
      },
      {
        path: 'reservations',
        label: 'Reservations',
        built: false,
        design: 'D1',
        phase: 'Phase 1',
        summary: 'Every booking with its guest, channel and account, payout, documents and history.',
      },
      {
        path: 'inbox',
        label: 'Inbox',
        built: false,
        design: 'D2',
        phase: 'Phase 2',
        summary:
          'Airbnb and Booking.com messages in one thread per guest, with response timers and templates.',
      },
      {
        path: 'tasks',
        label: 'Tasks',
        built: false,
        design: 'D3',
        phase: 'Phase 3',
        summary: 'Cleans, maintenance and inspections, assigned to the field team and checked with photos.',
      },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { path: 'properties', label: 'Properties', built: true },
      {
        path: 'channels',
        label: 'Channels & sync',
        built: false,
        design: 'D1',
        phase: 'Phase 1',
        summary: 'Channel accounts, listing mapping, sync health and the nightly cross-check.',
      },
      {
        path: 'reviews',
        label: 'Reviews',
        built: false,
        design: 'D2',
        phase: 'Phase 2',
        summary:
          'Every review for a property across all its accounts, with replies and an alert under 4 stars.',
      },
      {
        path: 'claims',
        label: 'Claims',
        built: false,
        design: 'D3',
        phase: 'Phase 3',
        summary: 'Damage claims from received to closed, with check-in and checkout photos side by side.',
      },
    ],
  },
  {
    label: 'Money',
    items: [
      {
        path: 'bookings',
        label: 'Bookings & invoices',
        built: false,
        design: 'D4',
        phase: 'Phase 4',
        summary: 'Direct and contractor bookings, quotes, payment links and company invoices.',
      },
      {
        path: 'insights',
        label: 'Insights',
        built: false,
        design: 'D4',
        phase: 'Phase 4',
        summary: 'Occupancy, ADR, review scores and claim costs by property, area, channel and account.',
      },
    ],
  },
  {
    label: 'Settings',
    items: [{ path: 'workspace', label: 'Workspace', built: true }],
  },
];

export const PENDING_MODULES = MODULE_GROUPS.flatMap((g) => g.items).filter((m) => !m.built);
