import { describe, expect, it } from 'vitest';
import { type Alert, type AlertSink, AppAlerts, SlackWebhookSink } from '../src/index.ts';

describe('Slack alerts', () => {
  it('posts the title, detail and a link to the fix', async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    await new SlackWebhookSink('https://hooks.slack.test/abc', fetchImpl).send({
      severity: 'urgent',
      title: 'Airbnb B rejected the price for 12 Nov',
      detail: 'Harbour View Lodge: rate must be greater than 0',
      link: 'https://app.example.test/channels',
    });
    const text = JSON.parse(bodies[0] ?? '{}').text as string;
    expect(text).toContain('*Airbnb B rejected the price for 12 Nov*');
    expect(text).toContain('Harbour View Lodge');
    expect(text).toContain('Open in the app');
  });

  it('fails loudly when Slack refuses the message', async () => {
    const fetchImpl = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
    await expect(
      new SlackWebhookSink('https://hooks.slack.test/abc', fetchImpl).send({ severity: 'info', title: 'x' }),
    ).rejects.toThrow('Slack returned 404');
  });
});

describe('alerts from the worker', () => {
  it('adds the app’s address to the path, and keeps a Slack failure to itself', async () => {
    const sent: Alert[] = [];
    const errors: string[] = [];
    const inner: AlertSink = {
      async send(alert) {
        if (alert.title === 'boom') throw new Error('Slack returned 500');
        sent.push(alert);
      },
    };
    const alerts = new AppAlerts(inner, {
      appUrl: 'https://app.example.test/',
      onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });
    await alerts.send({ severity: 'warning', title: 'Drift', path: '/properties/abc' });
    expect(sent[0]).toMatchObject({ title: 'Drift', link: 'https://app.example.test/properties/abc' });
    await expect(
      alerts.send({ severity: 'urgent', title: 'boom', path: '/channels' }),
    ).resolves.toBeUndefined();
    expect(errors).toEqual(['Slack returned 500']);
    // Without an address, the path stays a path and nothing links.
    const bare = new AppAlerts(inner);
    await bare.send({ severity: 'info', title: 'Quiet', path: '/channels' });
    expect(sent[1]?.link).toBeUndefined();
  });
});
