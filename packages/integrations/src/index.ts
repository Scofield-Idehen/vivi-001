export {
  type Alert,
  type AlertSeverity,
  type AlertSink,
  AppAlerts,
  LogSink,
  SlackWebhookSink,
} from './alerts.ts';

/*
 * Planned adapters, each behind its own interface like the channel swap layer
 * (playbook, Section 15). Credentials are stored encrypted and per operator.
 *   pricelabs/  Phase 4: sync URL, calendar trigger URL, /listings, /calendar, /reservations, /get_prices
 *   stripe/     Phase 4: Stripe Connect payment links on each operator's own account
 *   email/      Phase 2: confirmations and digests from the operator's own domain
 */
