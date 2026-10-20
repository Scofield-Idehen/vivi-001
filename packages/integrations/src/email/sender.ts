/**
 * Email to guests (playbook, Section 15: "email/ Phase 2"). One interface; Resend behind it for
 * now, because it takes a key and a verified domain and nothing else. The worker uses it for
 * direct guests, who have no site chat; Airbnb and Booking.com guests are reached through Channex.
 */

export interface OutgoingEmail {
  to: string;
  /** "Name <address>"; the operator's name on the worker's one sending address. */
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** Resolves with the service's id for the message; throws with the reason when it is refused. */
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

export const RESEND_API_URL = 'https://api.resend.com';

export class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl: string = RESEND_API_URL,
  ) {}

  async send(email: OutgoingEmail): Promise<{ id: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        text: email.text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      throw new EmailError(body.message ?? `The email service answered ${response.status}.`, response.status);
    }
    if (!body.id) throw new EmailError('The email service sent no id back.', response.status);
    return { id: body.id };
  }
}

/** Keeps what would have been sent; for tests and the demo. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  failWith: string | null = null;

  async send(email: OutgoingEmail): Promise<{ id: string }> {
    if (this.failWith) throw new EmailError(this.failWith, 422);
    this.sent.push(email);
    return { id: `mem-${this.sent.length}` };
  }
}
