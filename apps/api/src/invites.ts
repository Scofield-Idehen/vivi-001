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

/**
 * Makes a colleague's sign-in without emailing them (1 Nov 2026), so the team can give them jobs
 * before they ever sign in; they sign in later with the usual email link, as the same person.
 * Returns their sign-in id. An email that already has a sign-in returns that one.
 */
export interface UserDirectory {
  ensure(email: string, name: string): Promise<string>;
}

export const NO_USER_DIRECTORY: UserDirectory = {
  async ensure() {
    throw new Error('The API has no Supabase service key, so it cannot add people before they sign in.');
  },
};

export class SupabaseUserDirectory implements UserDirectory {
  constructor(private readonly options: { supabaseUrl: string; serviceKey: string; fetch?: typeof fetch }) {}

  private call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Response> {
    const doFetch = this.options.fetch ?? fetch;
    return doFetch(`${this.options.supabaseUrl.replace(/\/$/, '')}/auth/v1${path}`, {
      method: init.method,
      headers: {
        apikey: this.options.serviceKey,
        authorization: `Bearer ${this.options.serviceKey}`,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  async ensure(email: string, name: string): Promise<string> {
    const made = await this.call('/admin/users', {
      method: 'POST',
      body: { email, email_confirm: true, user_metadata: { full_name: name } },
    });
    const text = await made.text();
    if (made.ok) {
      const id = (JSON.parse(text) as { id?: string }).id;
      if (id) return id;
    }
    if (made.status === 422 || /already/i.test(text)) {
      // Already has a sign-in: find it.
      for (let page = 1; page <= 50; page++) {
        const list = await this.call(`/admin/users?page=${page}&per_page=200`, { method: 'GET' });
        if (!list.ok) break;
        const { users = [] } = (await list.json()) as { users?: { id: string; email?: string }[] };
        const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (found) return found.id;
        if (users.length < 200) break;
      }
    }
    throw new Error(`Supabase would not make a sign-in for ${email} (${made.status}): ${text.slice(0, 160)}`);
  }
}

/** For tests: a sign-in id per email, made up and remembered. */
export class MemoryUserDirectory implements UserDirectory {
  readonly made = new Map<string, string>();
  async ensure(email: string): Promise<string> {
    const key = email.toLowerCase();
    let id = this.made.get(key);
    if (!id) {
      id = crypto.randomUUID();
      this.made.set(key, id);
    }
    return id;
  }
}
