import {
  IconArrowsExchange,
  IconCalendarMonth,
  IconChartBar,
  IconChecklist,
  IconClipboardText,
  IconFileAlert,
  IconFileInvoice,
  IconHome,
  IconInbox,
  IconSettings,
  IconStar,
  IconSun,
  type TablerIcon,
} from '@tabler/icons-react';

/**
 * The module map from the design roadmap (page 12). Built modules have a page;
 * the rest show when they arrive, so the team can see the whole shape from day one.
 */
export interface ModuleEntry {
  path: string;
  label: string;
  icon: TablerIcon;
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
      { path: 'today', label: 'Today', icon: IconSun, built: true },
      {
        path: 'calendar',
        label: 'Calendar',
        icon: IconCalendarMonth,
        built: true,
        design: 'D1',
        phase: 'Phase 1',
        summary:
          'Every property by date: bookings, blocks, turnovers, prices, minimum stays and price limits.',
      },
      {
        path: 'reservations',
        label: 'Reservations',
        icon: IconClipboardText,
        built: false,
        design: 'D1',
        phase: 'Phase 1',
        summary: 'Every booking with its guest, channel and account, payout, documents and history.',
      },
      {
        path: 'inbox',
        label: 'Inbox',
        icon: IconInbox,
        built: false,
        design: 'D2',
        phase: 'Phase 2',
        summary:
          'Airbnb and Booking.com messages in one thread per guest, with response timers and templates.',
      },
      {
        path: 'tasks',
        label: 'Tasks',
        icon: IconChecklist,
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
      { path: 'properties', label: 'Properties', icon: IconHome, built: true },
      {
        path: 'channels',
        label: 'Channels & sync',
        icon: IconArrowsExchange,
        built: false,
        design: 'D1',
        phase: 'Phase 1',
        summary: 'Channel accounts, listing mapping, sync health and the nightly cross-check.',
      },
      {
        path: 'reviews',
        label: 'Reviews',
        icon: IconStar,
        built: false,
        design: 'D2',
        phase: 'Phase 2',
        summary:
          'Every review for a property across all its accounts, with replies and an alert under 4 stars.',
      },
      {
        path: 'claims',
        label: 'Claims',
        icon: IconFileAlert,
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
        icon: IconFileInvoice,
        built: false,
        design: 'D4',
        phase: 'Phase 4',
        summary: 'Direct and contractor bookings, quotes, payment links and company invoices.',
      },
      {
        path: 'insights',
        label: 'Insights',
        icon: IconChartBar,
        built: false,
        design: 'D4',
        phase: 'Phase 4',
        summary: 'Occupancy, ADR, review scores and claim costs by property, area, channel and account.',
      },
    ],
  },
  {
    label: 'Settings',
    items: [{ path: 'workspace', label: 'Workspace', icon: IconSettings, built: true }],
  },
];

export const PENDING_MODULES = MODULE_GROUPS.flatMap((g) => g.items).filter((m) => !m.built);
