import { describe, expect, it } from 'vitest';
import { SlackWebhookSink } from '../src/index.ts';

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
