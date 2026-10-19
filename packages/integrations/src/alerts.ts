/**
 * Alerts reach a person in minutes (playbook, Section 14). Operational alerts go to the
 * operator's own Slack channel; platform alerts go to V-01's.
 */

export type AlertSeverity = 'urgent' | 'warning' | 'info';

export interface Alert {
  severity: AlertSeverity;
  title: string;
  detail?: string;
  /** Where in the app to fix it, as a path such as /properties/…; the sink turns it into a link. */
  path?: string;
  /** A full link, when the path isn't enough. */
  link?: string;
}

export interface AlertSink {
  send(alert: Alert): Promise<void>;
}

const ICON: Record<AlertSeverity, string> = {
  urgent: ':red_circle:',
  warning: ':large_orange_circle:',
  info: ':white_circle:',
};

/**
 * Wraps a sink for the worker: adds the app's address to each alert's path, so the message opens in
 * the right place, and never lets a failed alert fail the work it reports on. The sync log is the
 * record; the alert is the nudge, and a Slack outage must not stop a cross-check or a booking.
 */
export class AppAlerts implements AlertSink {
  constructor(
    private readonly inner: AlertSink,
    private readonly options: {
      appUrl?: string | null;
      onError?: (error: unknown, alert: Alert) => void;
    } = {},
  ) {}

  async send(alert: Alert): Promise<void> {
    const link =
      alert.link ??
      (alert.path && this.options.appUrl
        ? `${this.options.appUrl.replace(/\/$/, '')}${alert.path}`
        : undefined);
    try {
      await this.inner.send(link ? { ...alert, link } : alert);
    } catch (error) {
      this.options.onError?.(error, alert);
    }
  }
}

/** Posts to a Slack incoming webhook. */
export class SlackWebhookSink implements AlertSink {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    const lines = [`${ICON[alert.severity]} *${alert.title}*`];
    if (alert.detail) lines.push(alert.detail);
    if (alert.link) lines.push(`<${alert.link}|Open in the app>`);
    const response = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Slack returned ${response.status}`);
  }
}

/** Writes alerts to the log. Used locally and as a fallback when Slack is not configured. */
export class LogSink implements AlertSink {
  constructor(private readonly log: (message: string) => void = console.warn) {}

  async send(alert: Alert): Promise<void> {
    this.log(`[alert:${alert.severity}] ${alert.title}${alert.detail ? ` — ${alert.detail}` : ''}`);
  }
}
