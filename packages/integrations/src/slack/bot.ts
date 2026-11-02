/**
 * Slack direct messages to the team (2 Nov 2026): a cleaner or repairer hears about a job where they
 * already are. One Slack app (a bot) installed in the operator's Slack, with chat:write,
 * im:write and users:read.email; its bot token (xoxb-…) lives only in GitHub secrets. People are
 * found by the email they sign in to V-01 with, so nothing extra is kept about them.
 *
 * Behind an interface so tests and the demo use the stand-in.
 */

export interface SlackSender {
  /** The Slack member with this email, or null when there is none in the workspace. */
  userIdByEmail(email: string): Promise<string | null>;
  /** A direct message from the app to that member. */
  dm(userId: string, text: string): Promise<void>;
  /** The Slack workspace's name, to show the connection works. */
  team(): Promise<string>;
}

export class SlackError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SlackError';
  }
}

export class SlackBot implements SlackSender {
  constructor(private readonly options: { token: string; fetchImpl?: typeof fetch; baseUrl?: string }) {}

  private async call<T>(method: string, body: Record<string, string>): Promise<T> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(`${this.options.baseUrl ?? 'https://slack.com/api'}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.token}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new SlackError(`Slack returned ${response.status}`, 'http');
    const json = (await response.json()) as T & { ok: boolean; error?: string };
    if (!json.ok) throw new SlackError(`Slack: ${json.error ?? 'error'}`, json.error ?? 'error');
    return json;
  }

  async userIdByEmail(email: string): Promise<string | null> {
    try {
      const r = await this.call<{ user: { id: string } }>('users.lookupByEmail', { email });
      return r.user.id;
    } catch (error) {
      if (error instanceof SlackError && error.code === 'users_not_found') return null;
      throw error;
    }
  }

  async dm(userId: string, text: string): Promise<void> {
    const open = await this.call<{ channel: { id: string } }>('conversations.open', { users: userId });
    await this.call('chat.postMessage', { channel: open.channel.id, text, unfurl_links: 'false' });
  }

  async team(): Promise<string> {
    const r = await this.call<{ team: string }>('auth.test', {});
    return r.team;
  }
}

/** The stand-in: remembers what it would have sent. Emails in `members` are found. */
export class MemorySlack implements SlackSender {
  readonly sent: { userId: string; text: string }[] = [];
  constructor(readonly members: Record<string, string> = {}) {}
  async userIdByEmail(email: string) {
    return this.members[email.toLowerCase()] ?? null;
  }
  async dm(userId: string, text: string) {
    this.sent.push({ userId, text });
  }
  async team() {
    return 'Test Slack';
  }
}
