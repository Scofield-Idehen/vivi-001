import type { EmailSender, SecretBox } from '@v01/integrations';
import { addDays, longDay, MESSAGE_VIA_LABELS, type MessageVia, renderTemplate, todayIn } from '@v01/shared';
import { sql } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';

/**
 * The Inbox's two jobs (design roadmap, Phase 2).
 *
 * `makeAutomaticMessages` writes the automatic messages into each booking's thread when their
 * moment comes: a confirmation for a new booking, the day before arrival, the day of arrival, the
 * day before check-out, each at the time the template says, where the operator is. One per
 * template per thread (a unique index), so running every few minutes never doubles one.
 *
 * `sendQueuedMessages` sends what is queued: a direct guest's email through the email sender;
 * everything else waits, with the reason on the message, until there is something to send it with
 * (a texting service; the sites' chats through Channex). A message that waits goes the moment the
 * sender appears, and nothing is lost in between.
 */

export interface Senders {
  email?: EmailSender;
  /** The one address V-01 sends from, "hello@vivistays.com"; the operator's name goes in front. */
  from?: string;
}

const SITE_CHATS = new Set(['airbnb', 'booking_com', 'vrbo', 'expedia']);

function via(channel: string, email: string | null, phone: string | null): MessageVia | null {
  if (SITE_CHATS.has(channel)) return channel as MessageVia;
  if (email) return 'email';
  if (phone) return 'sms';
  return null;
}

type Due = {
  thread_id: string;
  template_id: string;
  channel: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  property_name: string;
  check_in: string;
  check_out: string;
  check_in_time: string;
  check_out_time: string;
  guest_key: string;
  body: string;
  operator: string;
  door_code: Buffer | null;
};

const clock = (t: string) => t.slice(0, 5);

export async function makeAutomaticMessages(
  deps: Pick<WorkerDeps, 'db' | 'log' | 'now'>,
  options: { appUrl?: string; box?: SecretBox } = {},
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const at = now.toISOString();
  let made = 0;
  for (const org of await deps.db.listOrganisations()) {
    made += await deps.db.withOrg({ orgId: org.id }, async (tx) => {
      const [settings] = await tx
        .execute<{ time_zone: string; operator: string }>(sql`
          select s.time_zone, b.display_name as operator
            from app.organisation_settings s
            join app.organisation_brand b on b.organisation_id = s.organisation_id`)
        .then((r) => r.rows);
      if (!settings) return 0;
      const today = todayIn(settings.time_zone, now);
      const tomorrow = addDays(today, 1);
      // Local time now, "HH:MM", to compare with a template's send time.
      const localNow = new Intl.DateTimeFormat('en-GB', {
        timeZone: settings.time_zone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(now);
      const due = await tx
        .execute<Due>(sql`
          select th.id as thread_id, t.id as template_id, r.channel, g.full_name as guest_name,
                 g.email as guest_email, g.phone as guest_phone, p.name as property_name,
                 r.check_in::text, r.check_out::text,
                 to_char(coalesce(r.check_in_time, p.check_in_time), 'HH24:MI') as check_in_time,
                 to_char(coalesce(r.check_out_time, p.check_out_time), 'HH24:MI') as check_out_time,
                 r.guest_key, t.body, ${settings.operator} as operator,
                 (select c.code_sealed from app.lock_codes c
                   where c.reservation_id = r.id and c.kind = 'guest' and c.status = 'set'
                   order by c.created_at limit 1) as door_code
            from app.message_templates t
            cross join app.reservations r
            join app.message_threads th on th.reservation_id = r.id
            join app.properties p on p.id = r.property_id
            left join app.guests g on g.id = r.guest_id
           where t.enabled and t.trigger <> 'manual'
             and r.status = 'confirmed'
             and (t.send_time is null or to_char(t.send_time, 'HH24:MI') <= ${localNow})
             and case t.trigger
                   -- A booking made in the last day, that did not come over from Guesty with its own history.
                   when 'booking_confirmed' then r.created_at > ${at}::timestamptz - interval '1 day'
                        and r.check_in >= ${today}::date
                        and not exists (select 1 from app.guesty_reservations gr where gr.reservation_id = r.id)
                   when 'before_arrival' then r.check_in = ${tomorrow}::date
                   when 'arrival_day' then r.check_in = ${today}::date
                   when 'before_departure' then r.check_out = ${tomorrow}::date
                   else false
                 end
             and not exists (
               select 1 from app.messages m where m.thread_id = th.id and m.template_id = t.id and m.automatic
             )
           order by r.check_in, p.name`)
        .then((r) => r.rows);
      let count = 0;
      for (const d of due) {
        const way = via(d.channel, d.guest_email, d.guest_phone);
        if (!way) continue; // Nobody to send it to; the team sees the empty thread.
        const base = (options.appUrl ?? '').replace(/\/$/, '');
        const body = renderTemplate(d.body, {
          guest_first_name: d.guest_name?.trim().split(/\s+/)[0] ?? 'there',
          guest_name: d.guest_name ?? 'Guest',
          property: d.property_name,
          check_in: longDay(d.check_in),
          check_in_time: clock(d.check_in_time),
          check_out: longDay(d.check_out),
          check_out_time: clock(d.check_out_time),
          nights: String(
            Math.round(
              (Date.parse(`${d.check_out}T00:00:00Z`) - Date.parse(`${d.check_in}T00:00:00Z`)) / 86_400_000,
            ),
          ),
          stay_link: `${base}/stay/${d.guest_key}`,
          operator: d.operator,
          // Only when the lock holds it; otherwise the guest is pointed at their page, where it appears.
          door_code:
            (d.door_code && options.box?.open(Buffer.from(d.door_code))) ||
            `on your page from the day you arrive: ${base}/stay/${d.guest_key}`,
        });
        const inserted = await tx.execute(sql`
          insert into app.messages (organisation_id, thread_id, direction, via, body, status, template_id, automatic)
          values (${org.id}, ${d.thread_id}, 'out', ${way}, ${body}, 'queued', ${d.template_id}, true)
          on conflict do nothing
          returning id`);
        count += inserted.rows.length;
      }
      return count;
    });
  }
  if (made) deps.log.info({ made }, 'Automatic messages queued');
  return made;
}

type Queued = {
  id: string;
  via: string;
  body: string;
  status: string;
  note: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  property_name: string;
  operator: string;
  reply_to: string | null;
};

function waitingNote(via: string, senders: Senders): string | null {
  if (via === 'email')
    return senders.email && senders.from ? null : 'No email sender is set up yet. It goes as soon as one is.';
  if (via === 'sms') return 'Text messages need a texting service, which is not connected yet.';
  return `The ${MESSAGE_VIA_LABELS[via as MessageVia] ?? via} is not connected yet; it goes through Channex once it is.`;
}

export async function sendQueuedMessages(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  senders: Senders,
  limit = 50,
): Promise<{ sent: number; waiting: number; failed: number }> {
  const totals = { sent: 0, waiting: 0, failed: 0 };
  for (const org of await deps.db.listOrganisations()) {
    await deps.db.withOrg({ orgId: org.id }, async (tx) => {
      const rows = await tx
        .execute<Queued>(sql`
          select m.id, m.via, m.body, m.status, m.note, g.email as guest_email, g.phone as guest_phone,
                 p.name as property_name, b.display_name as operator, b.sender_email as reply_to
            from app.messages m
            join app.message_threads th on th.id = m.thread_id
            join app.reservations r on r.id = th.reservation_id
            join app.properties p on p.id = r.property_id
            join app.organisation_brand b on b.organisation_id = m.organisation_id
            left join app.guests g on g.id = r.guest_id
           where m.direction = 'out' and m.status in ('queued', 'waiting')
           order by m.created_at
           limit ${limit}`)
        .then((r) => r.rows);
      for (const m of rows) {
        const note = waitingNote(m.via, senders);
        if (note) {
          totals.waiting += 1;
          if (m.status !== 'waiting' || m.note !== note) {
            await tx.execute(
              sql`update app.messages set status = 'waiting', note = ${note} where id = ${m.id}`,
            );
          }
          continue;
        }
        // Email, with a sender.
        if (!m.guest_email) {
          totals.failed += 1;
          await tx.execute(
            sql`update app.messages set status = 'failed', note = 'The guest has no email address any more.' where id = ${m.id}`,
          );
          continue;
        }
        try {
          const { id } = await (senders.email as EmailSender).send({
            to: m.guest_email,
            from: `${m.operator.replace(/[<>"]/g, '')} <${senders.from}>`,
            ...(m.reply_to ? { replyTo: m.reply_to } : {}),
            subject: `Your stay at ${m.property_name}`,
            text: m.body,
          });
          totals.sent += 1;
          await tx.execute(
            sql`update app.messages set status = 'sent', note = null, sent_at = now(), external_id = ${id} where id = ${m.id}`,
          );
        } catch (error) {
          totals.failed += 1;
          const reason = error instanceof Error ? error.message : String(error);
          deps.log.warn({ messageId: m.id, reason }, 'An email to a guest was refused');
          await tx.execute(
            sql`update app.messages set status = 'failed', note = ${reason} where id = ${m.id}`,
          );
        }
      }
    });
  }
  if (totals.sent || totals.failed) deps.log.info(totals, 'Guest messages sent');
  return totals;
}
