import {
  IconArrowDown,
  IconArrowUp,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconLock,
} from '@tabler/icons-react';
import {
  FIELD_KIND_HINTS,
  FIELD_KIND_LABELS,
  FIELD_KINDS,
  FIELD_NAME_MAX,
  FIELD_VALUE_MAX,
  FIELDS_MAX,
  type FieldKind,
  isWebAddress,
  type PropertyDetail,
  type PropertyField,
} from '@v01/shared';
import { type ReactNode, useId, useState } from 'react';
import { SelectField, TextArea, TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useCreateField, useDeleteField, useSetFields, useUpdateField } from '../../lib/api.ts';
import { V01 } from '../../lib/format.ts';
import { InvalidDraft, Section, SectionForm, useEditor } from './Section.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** A secret's value: dots until asked for, then the code, and dots again. */
function Secret({ value, name }: { value: string; name: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cx('tnum', !shown && 'tracking-[0.2em] text-mist')} aria-live="polite">
        {shown ? value : '••••••'}
      </span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? `Hide ${name}` : `Show ${name}`}
        className="inline-flex items-center gap-1 rounded text-[12.5px] text-accent underline-offset-4 hover:underline"
      >
        {shown ? (
          <IconEyeOff size={14} stroke={1.75} aria-hidden />
        ) : (
          <IconEye size={14} stroke={1.75} aria-hidden />
        )}
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}

/** What a field shows when nobody is editing. */
function Value({ field }: { field: PropertyField }) {
  if (field.hidden) {
    return (
      <span className="inline-flex items-center gap-1.5 text-mist" title="Your role can't see secrets.">
        <IconLock size={14} stroke={1.75} aria-hidden />
        Set, and hidden for your role
      </span>
    );
  }
  if (field.value === null || field.value === '') return <span className="text-mist">Not set</span>;
  switch (field.kind) {
    case 'link':
      return (
        <a
          href={field.value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 text-accent underline-offset-4 hover:underline"
        >
          <span className="truncate">{field.value.replace(/^https?:\/\//, '')}</span>
          <IconExternalLink size={14} stroke={1.75} aria-hidden className="shrink-0" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    case 'secret':
      return <Secret value={field.value} name={field.name} />;
    case 'long_text':
      return <span className="whitespace-pre-line">{field.value}</span>;
    default:
      return <>{field.value}</>;
  }
}

/** One input per field, matched to its kind. Secrets type as a password until shown. */
function ValueInput({
  field,
  value,
  onChange,
}: {
  field: PropertyField;
  value: string;
  onChange(value: string): void;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  switch (field.kind) {
    case 'long_text':
      return <TextArea label={field.name} value={value} onChange={onChange} max={FIELD_VALUE_MAX} rows={4} />;
    case 'link':
      return (
        <TextField
          label={field.name}
          value={value}
          onChange={onChange}
          placeholder="https://"
          hint="A web address, such as a shared document."
        />
      );
    case 'secret':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={id} className="text-[13px] text-slate">
              {field.name}
            </label>
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              className="text-[12.5px] text-accent underline-offset-4 hover:underline"
            >
              {shown ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id={id}
            type={shown ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            className="h-9 rounded-md border border-edge bg-white px-3 text-[14px] text-ink tnum focus:border-accent focus:outline-none"
          />
          <p className="text-[12.5px] text-mist">
            Stored encrypted. Accounts and {V01} support never see it.
          </p>
        </div>
      );
    default:
      return <TextField label={field.name} value={value} onChange={onChange} max={FIELD_VALUE_MAX} />;
  }
}

/** Admins define the fields here: add one, rename, reorder, remove. */
function Manage({ fields, orgId, onDone }: { fields: PropertyField[]; orgId: string; onDone(): void }) {
  const create = useCreateField(orgId);
  const update = useUpdateField(orgId);
  const remove = useDeleteField(orgId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');
  const [removing, setRemoving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const busy = create.isPending || update.isPending || remove.isPending;
  const error = [create.error, update.error, remove.error].find(Boolean);

  return (
    <div className="rounded-xl border border-hairline p-4">
      <p className="text-[14.5px] font-medium text-ink">Fields on every property</p>
      <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-slate">
        Each field appears on every property's page. Removing one removes its values everywhere.
      </p>
      {fields.length ? (
        <ol className="mt-4 divide-y divide-hairline border-y border-hairline">
          {fields.map((f, index) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-[14px]">
              {renaming?.id === f.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = renaming.name.trim();
                    if (!next || next === f.name) return setRenaming(null);
                    update.mutate({ id: f.id, name: next }, { onSuccess: () => setRenaming(null) });
                  }}
                >
                  <input
                    aria-label="New name"
                    value={renaming.name}
                    maxLength={FIELD_NAME_MAX}
                    onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                    className="h-8 min-w-0 flex-1 rounded-md border border-edge bg-white px-2.5 text-[14px] focus:border-accent focus:outline-none"
                  />
                  <Button variant="primary" type="submit" disabled={busy} className="!h-8">
                    Save
                  </Button>
                  <Button variant="quiet" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                  <span className="text-[12.5px] text-mist">{FIELD_KIND_LABELS[f.kind]}</span>
                </>
              )}
              {renaming?.id !== f.id ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${f.name} up`}
                    disabled={busy || index === 0}
                    onClick={() => update.mutate({ id: f.id, position: index - 1 })}
                    className="rounded p-1 text-slate hover:bg-linen disabled:opacity-30"
                  >
                    <IconArrowUp size={15} stroke={1.75} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${f.name} down`}
                    disabled={busy || index === fields.length - 1}
                    onClick={() => update.mutate({ id: f.id, position: index + 1 })}
                    className="rounded p-1 text-slate hover:bg-linen disabled:opacity-30"
                  >
                    <IconArrowDown size={15} stroke={1.75} aria-hidden />
                  </button>
                  <Button
                    variant="quiet"
                    className="ml-2"
                    onClick={() => setRenaming({ id: f.id, name: f.name })}
                  >
                    Rename
                  </Button>
                  {removing === f.id ? (
                    <>
                      <Button
                        variant="primary"
                        disabled={busy}
                        className="!h-8"
                        onClick={() => remove.mutate(f.id, { onSuccess: () => setRemoving(null) })}
                      >
                        Remove everywhere
                      </Button>
                      <Button variant="quiet" onClick={() => setRemoving(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button variant="quiet" className="ml-3" onClick={() => setRemoving(f.id)}>
                      Remove
                    </Button>
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {fields.length < FIELDS_MAX ? (
        <form
          className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({ name: name.trim(), kind }, { onSuccess: () => setName('') });
          }}
        >
          <TextField
            label="New field"
            value={name}
            onChange={setName}
            max={FIELD_NAME_MAX}
            placeholder="Lock code"
          />
          <SelectField<FieldKind>
            label="Kind"
            value={kind}
            onChange={setKind}
            options={FIELD_KINDS.map((k) => ({ value: k, label: FIELD_KIND_LABELS[k] }))}
          />
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            Add
          </Button>
          <p className="text-[12.5px] text-mist sm:col-span-3">{FIELD_KIND_HINTS[kind]}</p>
        </form>
      ) : (
        <p className="mt-4 text-[13px] text-mist">A workspace can have {FIELDS_MAX} fields.</p>
      )}
      {error ? (
        <div className="mt-3">
          <Notice tone="urgent">
            {error instanceof ApiError ? error.message : 'That didn’t go through. Try again.'}
          </Notice>
        </div>
      ) : null}
      <div className="mt-4">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/**
 * Custom fields: the team's own details on every property, as Guesty has them. Check-in
 * instructions, lock codes, the cleaning policy, a note for the team. Admins choose the fields;
 * anyone who edits properties fills them in; secrets show only to roles allowed to see them.
 */
export function FieldsSection({
  d,
  orgId,
  canEdit,
  canManage,
}: {
  d: PropertyDetail;
  orgId: string;
  canEdit: boolean;
  canManage: boolean;
}) {
  const set = useSetFields(orgId, d.id);
  const [managing, setManaging] = useState(false);
  const editor = useEditor(
    () => Object.fromEntries(d.fields.filter((f) => !f.hidden).map((f) => [f.id, f.value ?? ''])),
    async (draft: Record<string, string>) => {
      const values: Record<string, string> = {};
      for (const f of d.fields) {
        if (f.hidden) continue;
        const next = (draft[f.id] ?? '').trim();
        if (next === (f.value ?? '')) continue;
        if (next && f.kind === 'link' && !isWebAddress(next)) {
          throw new InvalidDraft(`${f.name} needs a web address starting with https://.`);
        }
        values[f.id] = next;
      }
      if (Object.keys(values).length) await set.mutateAsync(values);
    },
  );

  const action =
    canManage && !editor.editing && !managing ? (
      <span className="flex items-center gap-3">
        <Button variant="quiet" onClick={() => setManaging(true)}>
          Manage fields
        </Button>
        {d.fields.length > 0 && canEdit ? (
          <Button onClick={() => editor.start()}>
            Edit<span className="sr-only"> custom fields</span>
          </Button>
        ) : null}
      </span>
    ) : undefined;

  let body: ReactNode;
  if (managing) {
    body = <Manage fields={d.fields} orgId={orgId} onDone={() => setManaging(false)} />;
  } else if (editor.editing && editor.draft) {
    const draft = editor.draft;
    body = (
      <SectionForm editor={editor}>
        {d.fields.map((f) =>
          f.hidden ? (
            <p key={f.id} className="text-[13.5px] text-mist">
              {f.name}: set, and hidden for your role.
            </p>
          ) : (
            <ValueInput
              key={f.id}
              field={f}
              value={draft[f.id] ?? ''}
              onChange={(v) => editor.set({ [f.id]: v })}
            />
          ),
        )}
      </SectionForm>
    );
  } else if (!d.fields.length) {
    body = (
      <p className="max-w-[62ch] text-[14px] leading-relaxed text-slate">
        {canManage
          ? 'No fields yet. Add the details your team needs on every property: a check-in instructions link, the lock code, the cleaning policy, a note for the team.'
          : 'No fields yet. An admin can add the details the team needs on every property.'}
      </p>
    );
  } else {
    body = (
      <dl className="divide-y divide-hairline border-y border-hairline">
        {d.fields.map((f) => (
          <div key={f.id} className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[200px_minmax(0,1fr)]">
            <dt className="text-[13.5px] text-slate">{f.name}</dt>
            <dd className="min-w-0 text-[14.5px] leading-relaxed text-ink">
              <Value field={f} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <Section
      id="fields"
      editor={d.fields.length ? editor : undefined}
      canEdit={canEdit && !managing && d.fields.length > 0 && !canManage}
      action={action}
      description="The team's own details for this property. Secrets are stored encrypted and shown only to the roles that need them."
    >
      {body}
    </Section>
  );
}
