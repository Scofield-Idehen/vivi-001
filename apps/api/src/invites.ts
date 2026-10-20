import type { InviteEmailResult } from '@v01/shared';

/**
 * The email that gets an invited colleague in. Supabase Auth sends it (its "Invite user" template,
 * from the same sender as the sign-in email), so there is nothing else to set up. Someone who
 * already has a sign-in gets a sign-in link instead; without a service key, nothing is sent and
 * the admin is told to pass the address on.
 */
export interface InviteMailer {
  send(email: string, redirectTo: string): Promise<InviteEmailResult>;
}

export const NO_INVITE_MAILER: InviteMailer = {
  async send() {
    return 'none';
  },
};

export class SupabaseInviteMailer implements InviteMailer {
  constructor(private readonly options: { supabaseUrl: string; serviceKey: string; fetch?: typeof fetch }) {}

  private get base(): string {
    return `${this.options.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const doFetch = this.options.fetch ?? fetch;
    return doFetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        apikey: this.options.serviceKey,
        authorization: `Bearer ${this.options.serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async send(email: string, redirectTo: string): Promise<InviteEmailResult> {
    const invited = await this.post(`/invite?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
    if (invited.ok) return 'invited';
    const text = await invited.text().catch(() => '');
    // Already registered: a sign-in link does the same job.
    if (invited.status === 422 || /already/i.test(text)) {
      const link = await this.post(`/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        email,
        create_user: false,
      });
      if (link.ok) return 'existing';
      throw new Error(
        `Supabase refused the sign-in link (${link.status}): ${await link.text().catch(() => '')}`,
      );
    }
    throw new Error(`Supabase refused the invitation (${invited.status}): ${text}`);
  }
}
