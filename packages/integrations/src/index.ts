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
 */
export {
  EmailError,
  type EmailSender,
  MemoryEmailSender,
  type OutgoingEmail,
  RESEND_API_URL,
  ResendSender,
} from './email/sender.ts';
export {
  GUESTY_API_URL,
  type GuestyCalendarDay,
  GuestyClient,
  type GuestyConfig,
  type GuestyCustomField,
  GuestyError,
  type GuestyIntegration,
  type GuestyListing,
  type GuestyReservation,
  type GuestyToken,
  type GuestyTokenStore,
  MemoryTokenStore,
} from './guesty/client.ts';
export { SecretBox } from './secrets.ts';
