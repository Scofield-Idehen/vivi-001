import { CHANNEL_LABELS, CLAIM_PLACE_LABELS, CLAIM_STATUS_LABELS, type Claim } from '@v01/shared';
import { strToU8, zipSync } from 'fflate';
import { moneyText } from '../properties/money.ts';

/**
 * The evidence for a claim in one download: a short written summary, the team's photos from
 * before and after the stay, and every file added to the claim exactly as uploaded. Built in the
 * browser from the addresses the claim already has, so nothing new is sent anywhere.
 */

const day = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${d}T12:00:00`));

const safe = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file';

const extensionOf = (contentType: string, url: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  })[contentType] ??
  /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url)?.[1] ??
  'jpg';

export function claimText(claim: Claim, locale: string): string {
  const m = (minor: number) => moneyText(minor, claim.currency, locale);
  const lines = [
    `Damage claim: ${claim.guestName ?? 'Guest'} at ${claim.propertyName}`,
    '',
    `Stay: ${day(claim.checkIn)} to ${day(claim.checkOut)}`,
    `Booked on: ${CHANNEL_LABELS[claim.channel]}${claim.channelReference ? ` (${claim.channelReference})` : ''}`,
    `Filed with: ${CLAIM_PLACE_LABELS[claim.place]}`,
    `Deadline: ${day(claim.deadline)}`,
    `Status: ${CLAIM_STATUS_LABELS[claim.status]}${claim.filedOn ? `, filed ${day(claim.filedOn)}` : ''}${claim.filedReference ? `, reference ${claim.filedReference}` : ''}`,
    '',
  ];
  if (claim.summary) lines.push('What happened', claim.summary, '');
  lines.push('What was damaged');
  for (const i of claim.items) lines.push(`- ${i.description} (${m(i.amountMinor)})`);
  lines.push(`Total claimed: ${m(claim.claimedMinor)}`, '');
  if (claim.reports.length) {
    lines.push('Reported by the team');
    for (const r of claim.reports) lines.push(`- ${day(r.day)}${r.by ? `, ${r.by}` : ''}: ${r.what ?? ''}`);
    lines.push('');
  }
  lines.push(
    'In this download',
    `- before-the-stay/: ${claim.before.length} photos from the clean before the guest arrived`,
    `- after-the-stay/: ${claim.after.length} photos from the team's jobs after they left`,
    `- files/: ${claim.files.length} photos, videos, receipts and invoices, as uploaded`,
    '',
    'Photos from the team carry the time, the home and who took them, burned into the picture when it was taken.',
  );
  if (claim.receivedMinor !== null) lines.push('', `Received: ${m(claim.receivedMinor)}`);
  if (claim.outcome) lines.push(`Outcome: ${claim.outcome}`);
  return lines.join('\n');
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Builds the zip and hands it to the browser to save. Says which files couldn't be fetched. */
export async function downloadEvidence(
  claim: Claim,
  locale: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const entries: Record<string, Uint8Array> = { 'claim.txt': strToU8(claimText(claim, locale)) };
  const missing: string[] = [];
  const jobs: { name: string; url: string }[] = [
    ...claim.before.map((p, i) => ({
      name: `before-the-stay/${String(i + 1).padStart(2, '0')} ${p.taskDay} ${p.stage}.${extensionOf('', p.url)}`,
      url: p.url,
    })),
    ...claim.after.map((p, i) => ({
      name: `after-the-stay/${String(i + 1).padStart(2, '0')} ${p.taskDay} ${p.stage}.${extensionOf('', p.url)}`,
      url: p.url,
    })),
    ...claim.files.map((f, i) => {
      const base = safe(f.fileName);
      const named = /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.${extensionOf(f.contentType, f.url)}`;
      return { name: `files/${String(i + 1).padStart(2, '0')} ${named}`, url: f.url };
    }),
  ];
  let done = 0;
  for (const job of jobs) {
    const bytes = await fetchBytes(job.url);
    if (bytes) entries[job.name] = bytes;
    else missing.push(job.name.split('/').pop() ?? job.name);
    onProgress?.(++done, jobs.length);
  }
  // Photos and videos are already compressed; store them as they are.
  const zipped = zipSync(entries, { level: 0 });
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Claim ${safe(claim.guestName ?? 'guest')} ${safe(claim.propertyName)} ${claim.checkOut}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  return missing;
}
