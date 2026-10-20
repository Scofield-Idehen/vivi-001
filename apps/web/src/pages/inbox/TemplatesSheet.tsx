import { IconClock } from '@tabler/icons-react';
import {
  MESSAGE_MAX,
  MESSAGE_TRIGGER_LABELS,
  type MessageTemplate,
  TEMPLATE_NAME_MAX,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
} from '@v01/shared';
import { useState } from 'react';
import { TextArea, TextField, Toggle } from '../../components/fields.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useCreateMessageTemplate,
  useDeleteMessageTemplate,
  useMessageTemplates,
  useUpdateMessageTemplate,
} from '../../lib/api.ts';

/**
 * Automatic messages and saved replies. The four automatic ones come with the workspace: switch
 * each on or off, change its words and, for the day ones, its time. Saved replies are the team's
 * own, picked while writing.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function Placeholders() {
  return (
    <details className="rounded-lg bg-paper px-3.5 py-2.5 text-[12.5px] text-slate">
      <summary className="cursor-pointer text-ink">The words a message can fill in</summary>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {TEMPLATE_PLACEHOLDERS.map((p) => (
          <li key={p.key} className="flex gap-2">
            <code className="shrink-0 text-ink">{`{{${p.key}}}`}</code>
            <span>{p.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Editor({
  orgId,
  template,
  onDone,
  onCancel,
}: {
  orgId: string;
  /** An existing one to change, or null for a new saved reply. */
  template: MessageTemplate | null;
  onDone(): void;
  onCancel(): void;
}) {
  const create = useCreateMessageTemplate(orgId);
  const update = useUpdateMessageTemplate(orgId);
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [time, setTime] = useState(template?.sendTime ?? '');
  const timed =
    template !== null && template.trigger !== 'manual' && template.trigger !== 'booking_confirmed';
  const unknown = unknownPlaceholders(body);
  const timeOk = !timed || CLOCK.test(time);
  const ready =
    name.trim().length > 0 && body.trim().length > 0 && timeOk && !create.isPending && !update.isPending;
  const error = create.error ?? update.error;

  const save = () => {
    if (!ready) return;
    if (template) {
      update.mutate(
        { id: template.id, name: name.trim(), body: body.trim(), ...(timed ? { sendTime: time } : {}) },
        { onSuccess: onDone },
      );
    } else {
      create.mutate({ name: name.trim(), trigger: 'manual', body: body.trim() }, { onSuccess: onDone });
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-4">
      <TextField label="Name" value={name} onChange={setName} max={TEMPLATE_NAME_MAX} />
      {timed ? (
        <TextField
          label={`Sent at (${MESSAGE_TRIGGER_LABELS[template.trigger].toLowerCase()})`}
          value={time}
          onChange={setTime}
          placeholder="10:00"
          error={time && !timeOk ? 'A time like 10:00.' : undefined}
          hint="Where you are; the worker checks every few minutes."
        />
      ) : null}
      <TextArea label="Message" value={body} onChange={setBody} max={MESSAGE_MAX} rows={7} />
      {unknown.length ? (
        <Notice tone="urgent">
          Not a word a message can fill in: {unknown.map((u) => `{{${u}}}`).join(', ')}. It would go to the
          guest as written.
        </Notice>
      ) : null}
      <Placeholders />
      {error ? <Notice tone="urgent">{explain(error)}</Notice> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={!ready}>
          {template ? 'Save' : 'Add saved reply'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function TemplatesSheet({ orgId, onClose }: { orgId: string; onClose(): void }) {
  const list = useMessageTemplates(orgId);
  const update = useUpdateMessageTemplate(orgId);
  const remove = useDeleteMessageTemplate(orgId);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const templates = list.data?.templates ?? [];
  const automatic = templates.filter((t) => t.trigger !== 'manual');
  const saved = templates.filter((t) => t.trigger === 'manual');

  return (
    <Sheet
      title="Automatic messages"
      subtitle="Sent by themselves at the right moment, to every guest, by whatever way reaches them."
      onClose={onClose}
      width="md:w-[620px]"
      footer={
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {list.error ? <Notice tone="urgent">{explain(list.error)}</Notice> : null}
        <ul className="divide-y divide-hairline">
          {automatic.map((t) =>
            editing === t.id ? (
              <li key={t.id} className="py-3">
                <Editor
                  orgId={orgId}
                  template={t}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={t.id}>
                <Toggle
                  label={t.name}
                  description={
                    <>
                      <span className="inline-flex items-center gap-1">
                        {t.sendTime ? <IconClock size={13} stroke={1.75} aria-hidden /> : null}
                        {MESSAGE_TRIGGER_LABELS[t.trigger]}
                        {t.sendTime ? ` at ${t.sendTime}` : ''}
                      </span>
                      <span className="mt-1 line-clamp-2 whitespace-pre-line text-mist">{t.body}</span>
                      <button
                        type="button"
                        onClick={() => setEditing(t.id)}
                        className="action -ml-2.5 mt-0.5 !h-7"
                      >
                        Change the words
                      </button>
                    </>
                  }
                  checked={t.enabled}
                  onChange={(enabled) => update.mutate({ id: t.id, enabled })}
                />
              </li>
            ),
          )}
        </ul>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-serif text-[20px] text-ink">Saved replies</h3>
            {editing !== 'new' ? (
              <Button variant="quiet" onClick={() => setEditing('new')}>
                New saved reply
              </Button>
            ) : null}
          </div>
          <p className="text-[13px] text-slate">
            Answers you give often, picked while writing: parking, early arrival, where the bins go.
          </p>
          {editing === 'new' ? (
            <Editor
              orgId={orgId}
              template={null}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          ) : null}
          {saved.length === 0 && editing !== 'new' ? (
            <p className="text-[13px] text-mist">None yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {saved.map((t) =>
                editing === t.id ? (
                  <li key={t.id} className="py-3">
                    <Editor
                      orgId={orgId}
                      template={t}
                      onDone={() => setEditing(null)}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li key={t.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] text-ink">{t.name}</p>
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-[13px] text-slate">
                        {t.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button type="button" onClick={() => setEditing(t.id)} className="action">
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => remove.mutate(t.id)}
                        disabled={remove.isPending}
                        className="action action-urgent"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
