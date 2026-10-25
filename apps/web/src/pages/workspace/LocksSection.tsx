import { can, LOW_BATTERY, type Lock, type WorkspaceRole } from '@v01/shared';
import { useState } from 'react';
import { TextField } from '../../components/fields.tsx';
import { Button, Notice, StatusDot } from '../../components/ui.tsx';
import {
  ApiError,
  useConnectLocks,
  useDisconnectLocks,
  useLocks,
  useProperties,
  useRefreshLocks,
  useUpdateLock,
} from '../../lib/api.ts';
import { dateTime } from '../../lib/format.ts';

/**
 * Door locks (TTLock), as Guesty's Locks Manager does them: connect the TTLock app account once,
 * put each lock on its home, and turn codes on. Then every stay gets its own code from check-in to
 * check-out, and every job a code for its day only, made by the worker.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

export function LocksSection({ orgId, role }: { orgId: string; role: WorkspaceRole }) {
  const manage = can(role, 'locks.manage');
  const locks = useLocks(orgId);
  const properties = useProperties(orgId);
  const connect = useConnectLocks(orgId);
  const refresh = useRefreshLocks(orgId);
  const disconnect = useDisconnectLocks(orgId);
  const update = useUpdateLock(orgId);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const view = locks.data;
  const homes = properties.data?.properties ?? [];
  const error = connect.error ?? refresh.error ?? disconnect.error ?? update.error;

  return (
    <section id="locks" aria-labelledby="locks-heading" className="scroll-mt-6 lg:col-span-2">
      <h2 id="locks-heading" className="mb-1 text-[15px] font-medium">
        Door locks
      </h2>
      <p className="mb-3 max-w-[640px] text-[13px] text-slate">
        Connect your TTLock account and V-01 makes the codes: each stay gets its own, from check-in to half an
        hour after check-out, and each job gets a code that works on its day only. Codes go to the guest’s
        page and the cleaner’s job; cancelled stays lose theirs.
      </p>
      {locks.error ? <Notice tone="urgent">{explain(locks.error)}</Notice> : null}
      {error ? (
        <div className="mb-3">
          <Notice tone="urgent">{explain(error)}</Notice>
        </div>
      ) : null}

      {view && !view.available ? (
        <Notice tone="pending">
          V-01’s TTLock application isn’t set up on this server yet, so locks can’t be connected. Add
          TTLOCK_CLIENT_ID and TTLOCK_CLIENT_SECRET to the API and worker settings.
        </Notice>
      ) : null}

      {view?.available && !view.account && manage ? (
        <form
          className="flex max-w-[560px] flex-col gap-4 rounded-2xl border border-hairline bg-canvas p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username.trim() || !password) return;
            connect.mutate({ username: username.trim(), password }, { onSuccess: () => setPassword('') });
          }}
        >
          <h3 className="font-serif text-[20px] text-ink">Connect TTLock</h3>
          <TextField
            label="TTLock app email or phone"
            value={username}
            onChange={setUsername}
            autoComplete="username"
            hint="The account you sign in to the TTLock app with, the one that owns the locks. Not the developer account."
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-slate">TTLock app password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-9 rounded-lg border border-edge bg-white px-3 text-[14px] text-ink focus:border-accent focus:outline-none"
            />
            <span className="text-[12.5px] text-mist">
              Sent to TTLock once to sign in, then forgotten. V-01 keeps only the sign-in TTLock gives back,
              sealed.
            </span>
          </label>
          <div>
            <Button
              variant="primary"
              type="submit"
              disabled={!username.trim() || !password || connect.isPending}
            >
              {connect.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      ) : null}

      {view?.account ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-3 text-[14px]">
            <div className="min-w-0">
              <StatusDot status={view.account.status === 'connected' ? 'done' : 'urgent'}>
                {view.account.status === 'connected' ? 'Connected' : 'Not connected'} as{' '}
                {view.account.username}
              </StatusDot>
              <p className="mt-0.5 text-[12.5px] text-slate">
                {view.account.error ??
                  (view.account.syncedAt ? `Checked ${dateTime(view.account.syncedAt)}` : 'Not checked yet')}
                {view.account.gateways.length
                  ? ` · ${view.account.gateways
                      .map((g) => `${g.name} ${g.online ? 'online' : 'offline'}`)
                      .join(', ')}`
                  : ' · No gateway found'}
                {view.failedCodes ? ` · ${view.failedCodes} codes waiting to reach a lock` : ''}
              </p>
            </div>
            {manage ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="action"
                  disabled={refresh.isPending}
                  onClick={() => refresh.mutate()}
                >
                  {refresh.isPending ? 'Checking…' : 'Check locks now'}
                </button>
                <button
                  type="button"
                  className="action action-urgent"
                  disabled={disconnect.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Disconnect TTLock? V-01 stops making codes. Codes already on the locks keep working until they end.',
                      )
                    )
                      disconnect.mutate();
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>

          {view.account.status === 'error' && manage ? (
            <form
              className="mb-4 flex max-w-[560px] flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (password)
                  connect.mutate(
                    { username: view.account?.username ?? '', password },
                    { onSuccess: () => setPassword('') },
                  );
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] text-slate">Sign in again: TTLock app password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-9 w-[240px] rounded-lg border border-edge bg-white px-3 text-[14px] text-ink focus:border-accent focus:outline-none"
                />
              </label>
              <Button variant="primary" type="submit" disabled={!password || connect.isPending}>
                Reconnect
              </Button>
            </form>
          ) : null}

          {view.locks.length === 0 ? (
            <p className="text-[14px] text-slate">No locks on this TTLock account yet.</p>
          ) : (
            <ul className="divide-y divide-hairline border-y border-hairline">
              {view.locks.map((l) => (
                <LockRow
                  key={l.id}
                  lock={l}
                  manage={manage}
                  homes={homes}
                  busy={update.isPending}
                  onChange={(change) => update.mutate({ id: l.id, ...change })}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

function LockRow({
  lock,
  manage,
  homes,
  busy,
  onChange,
}: {
  lock: Lock;
  manage: boolean;
  homes: { id: string; name: string }[];
  busy: boolean;
  onChange(change: { propertyId?: string | null; makesCodes?: boolean }): void;
}) {
  const low = lock.battery !== null && lock.battery < LOW_BATTERY;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[14px]">
      <div className="min-w-0">
        <p className="text-ink">{lock.name}</p>
        <p className="text-[12.5px] text-slate">
          {lock.battery === null ? (
            'Battery unknown'
          ) : (
            <span className={low ? 'font-medium text-urgent' : undefined}>Battery {lock.battery}%</span>
          )}
          {' · '}
          {lock.hasGateway ? 'On a gateway' : 'No gateway: codes can’t be sent to it'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {manage ? (
          <select
            aria-label={`Home for ${lock.name}`}
            value={lock.propertyId ?? ''}
            disabled={busy}
            onChange={(e) => onChange({ propertyId: e.target.value || null })}
            className="h-8 max-w-[220px] rounded-lg border border-hairline bg-canvas px-2 text-[13px] text-ink"
          >
            <option value="">Not on a home</option>
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-slate">{lock.propertyName ?? 'Not on a home'}</span>
        )}
        <label
          className={`flex items-center gap-2 text-[13px] ${lock.propertyId && lock.hasGateway ? 'text-ink' : 'text-mist'}`}
        >
          <input
            type="checkbox"
            checked={lock.makesCodes}
            disabled={!manage || busy || !lock.propertyId || !lock.hasGateway}
            onChange={(e) => onChange({ makesCodes: e.target.checked })}
            className="size-4 accent-[var(--color-accent)]"
          />
          V-01 makes the codes
        </label>
      </div>
    </li>
  );
}
