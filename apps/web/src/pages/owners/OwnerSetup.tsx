import { IconFileText, IconLock } from '@tabler/icons-react';
import {
  type Contract,
  can,
  type Deal,
  type HomeTerms,
  type MaintenanceBy,
  type OwnerSetup as Setup,
  todayIn,
} from '@v01/shared';
import { useRef, useState } from 'react';
import { useConfirm } from '../../components/Confirm.tsx';
import { DateField } from '../../components/DateField.tsx';
import { TextField, Toggle } from '../../components/fields.tsx';
import { MonthPicker, monthName } from '../../components/MonthPicker.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  contractLink,
  useBankDetails,
  useOwnerSetup,
  useRemoveContract,
  useSaveContract,
  useSaveHomeSetup,
  useToken,
  useWorkspace,
} from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { shortDate } from '../../lib/format.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { moneyText } from '../properties/money.ts';
import { parseAmount } from '../reservations/Money.tsx';
import { feeText } from './OwnersPage.tsx';

/**
 * What each owner signed and what each home pays them (1 Nov 2026): the contracts, each home's
 * deal from a month on (a percentage, a fixed rent, or no fee for a board member), who arranges
 * maintenance, who is paid and where, and what a clean costs. Statements follow these.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');

export function dealText(
  t: HomeTerms | null | undefined,
  ownerFee: number,
  money: (m: number) => string,
): string {
  if (!t) return `${feeText(ownerFee)} (owner’s fee, not yet set for this home)`;
  if (t.deal === 'percentage') return `${feeText(t.feeBasisPoints ?? 0)} fee`;
  if (t.deal === 'fixed_rent') return `${money(t.rentMinor ?? 0)} a month, fixed`;
  return 'No fee (board)';
}

function useMoney() {
  const { orgId } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const currency = workspace.data?.settings.currency ?? 'GBP';
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  return {
    currency,
    month: todayIn(workspace.data?.settings.timeZone ?? 'Europe/London').slice(0, 7),
    money: (minor: number) => moneyText(minor, currency, locale),
  };
}

/** What's still missing, at the top of the owner's page. */
export function SetupBanner({ setup, notes }: { setup: Setup; notes: string | null }) {
  const m = setup.missing;
  const items = [
    m.contract ? 'their signed contract' : null,
    m.homesWithoutTerms
      ? `the deal for ${m.homesWithoutTerms} ${m.homesWithoutTerms === 1 ? 'home' : 'homes'}`
      : null,
    m.homesWithoutPayee
      ? `who is paid for ${m.homesWithoutPayee} ${m.homesWithoutPayee === 1 ? 'home' : 'homes'}`
      : null,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="mb-8 rounded-2xl border border-pending/40 bg-pending/10 px-5 py-4">
      <p className="text-[14.5px] font-medium text-ink">Set up payments</p>
      <p className="mt-0.5 text-[13.5px] text-slate">
        Still to add: {items.join(', ')}. Until a home has its deal, its statement uses the owner’s fee.
        {notes ? ' Their old notes from Guesty are beside the form, to copy from.' : ''}
      </p>
      <a href="#terms" className="action -ml-2.5 mt-1 inline-flex">
        Go to homes and terms
      </a>
    </div>
  );
}

export function TermsSection({
  ownerId,
  ownerFee,
  notes,
  write,
}: {
  ownerId: string;
  ownerFee: number;
  notes: string | null;
  write: boolean;
}) {
  const { orgId, entry } = useCurrentWorkspace();
  const setup = useOwnerSetup(orgId, ownerId);
  const { money } = useMoney();
  const [editing, setEditing] = useState<string | null>(null);
  const s = setup.data;
  if (!s) return setup.error ? <Notice tone="urgent">{explain(setup.error)}</Notice> : null;
  const seePayees = can(entry.role, 'payees.read');
  const home = s.homes.find((h) => h.id === editing);
  return (
    <>
      <section aria-labelledby="terms-title" id="terms" className="mb-8 scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="terms-title" className="text-[20px] font-semibold tracking-[-0.015em] text-ink">
            Homes and terms
          </h2>
          <p className="text-[13px] text-slate">From their contract. Statements follow these.</p>
        </div>
        {s.homes.length === 0 ? (
          <p className="text-[14px] text-slate">No homes chosen yet.</p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-canvas">
            {s.homes.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  disabled={!write}
                  onClick={() => setEditing(h.id)}
                  className="grid w-full grid-cols-1 gap-x-4 gap-y-1 px-4 py-3 text-left text-[14px] transition-colors enabled:hover:bg-paper md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{h.name}</span>
                    {h.terms ? (
                      <span className="block text-[12.5px] text-slate">since {monthName(h.terms.from)}</span>
                    ) : null}
                  </span>
                  <span className={h.terms ? 'text-ink' : 'text-pending-text'}>
                    {dealText(h.terms, ownerFee, money)}
                  </span>
                  <span className="text-slate">
                    {h.terms?.maintenanceBy === 'owner' ? 'Owner arranges repairs' : 'We arrange repairs'}
                    {h.cleaningCostMinor !== null ? ` · clean ${money(h.cleaningCostMinor)}` : ''}
                  </span>
                  <span className="min-w-0 truncate text-slate">
                    {!seePayees ? (
                      <span className="inline-flex items-center gap-1 text-mist">
                        <IconLock size={13} stroke={1.75} aria-hidden /> Payee hidden
                      </span>
                    ) : h.payee ? (
                      <>
                        Paid to <span className="text-ink">{h.payee.payeeName}</span>
                        {h.payee.accountHint ? ` ••••${h.payee.accountHint}` : ''}
                      </>
                    ) : (
                      <span className="text-pending-text">No payee yet</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ContractsSection ownerId={ownerId} contracts={s.contracts} write={write} />
      {home ? (
        <HomeSheet
          home={home}
          contracts={s.contracts}
          ownerFee={ownerFee}
          notes={notes}
          seePayees={seePayees}
          canWritePayee={can(entry.role, 'payees.write')}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string, string][];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] text-slate">{label}</legend>
      <div className={`grid grid-cols-1 gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {options.map(([v, title, hint]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`rounded-xl border px-3 py-2.5 text-left text-[14px] ${value === v ? 'border-accent bg-white' : 'border-hairline hover:border-edge'}`}
          >
            <span className="block font-medium text-ink">{title}</span>
            <span className="block text-[12.5px] text-slate">{hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function HomeSheet({
  home,
  contracts,
  ownerFee,
  notes,
  seePayees,
  canWritePayee,
  onClose,
}: {
  home: Setup['homes'][number];
  contracts: Contract[];
  ownerFee: number;
  notes: string | null;
  seePayees: boolean;
  canWritePayee: boolean;
  onClose(): void;
}) {
  const { orgId } = useCurrentWorkspace();
  const { currency, month: thisMonth, money } = useMoney();
  const save = useSaveHomeSetup(orgId);
  const bank = useBankDetails(orgId);
  const t = home.terms;
  const [deal, setDeal] = useState<Deal>(t?.deal ?? 'percentage');
  const [fee, setFee] = useState(String((t?.feeBasisPoints ?? ownerFee) / 100));
  const [rent, setRent] = useState(t?.rentMinor ? (t.rentMinor / 100).toFixed(2) : '');
  const [from, setFrom] = useState(t?.from ?? thisMonth);
  const [maintenance, setMaintenance] = useState<MaintenanceBy>(t?.maintenanceBy ?? 'company');
  const [contractId, setContractId] = useState<string>(t?.contractId ?? contracts[0]?.id ?? '');
  const [cleaning, setCleaning] = useState(
    home.cleaningCostMinor ? (home.cleaningCostMinor / 100).toFixed(2) : '',
  );
  const [payeeName, setPayeeName] = useState(home.payee?.payeeName ?? '');
  const [reference, setReference] = useState(home.payee?.reference ?? '');
  const [sortCode, setSortCode] = useState('');
  const [account, setAccount] = useState('');
  const feeNumber = Number(fee.replace('%', '').trim() || 'NaN');
  const feeOk = Number.isFinite(feeNumber) && feeNumber >= 0 && feeNumber <= 100;
  const rentParsed = rent.trim() ? parseAmount(rent, currency) : { error: 'The monthly rent.' };
  const cleaningParsed = cleaning.trim() ? parseAmount(cleaning, currency) : {};
  const bankGiven = sortCode.trim() || account.trim();
  const bankOk =
    !bankGiven || (/^\d{2}-?\d{2}-?\d{2}$/.test(sortCode.trim()) && /^\d{6,10}$/.test(account.trim()));
  const termsOk =
    deal === 'percentage' ? feeOk : deal === 'fixed_rent' ? rentParsed.minor !== undefined : true;
  const ready =
    termsOk &&
    bankOk &&
    (!cleaning.trim() || cleaningParsed.minor !== undefined) &&
    (!bankGiven || payeeName.trim());
  const opened = bank.data;
  return (
    <Sheet
      title={home.name}
      subtitle="The deal from their contract, who is paid, and what a clean costs"
      onClose={onClose}
      busy={save.isPending}
      width="md:w-[640px]"
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  propertyId: home.id,
                  terms: {
                    from,
                    deal,
                    feeBasisPoints: deal === 'percentage' ? Math.round(feeNumber * 100) : null,
                    rentMinor: deal === 'fixed_rent' ? (rentParsed.minor ?? 0) : null,
                    maintenanceBy: maintenance,
                    contractId: contractId || null,
                  },
                  ...(canWritePayee && payeeName.trim()
                    ? {
                        payee: {
                          payeeName: payeeName.trim(),
                          reference: reference.trim(),
                          ...(bankGiven ? { sortCode: sortCode.trim(), accountNumber: account.trim() } : {}),
                        },
                      }
                    : {}),
                  cleaningCostMinor: cleaning.trim() ? (cleaningParsed.minor ?? null) : null,
                },
                { onSuccess: onClose },
              )
            }
          >
            Save
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {notes ? (
          <details className="rounded-xl border border-hairline bg-paper px-4 py-3 text-[13px] text-slate">
            <summary className="cursor-pointer text-ink">Their old notes from Guesty</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{notes}</p>
          </details>
        ) : null}

        <Choice<Deal>
          label="The deal"
          value={deal}
          onChange={setDeal}
          options={[
            ['percentage', 'Percentage fee', 'A share of what each stay brings in'],
            ['fixed_rent', 'Fixed rent', 'The same each month, whatever it earns'],
            ['no_fee', 'No fee (board)', 'They get everything the stays bring in'],
          ]}
        />
        {deal === 'percentage' ? (
          <div className="max-w-[200px]">
            <TextField
              label="Fee (%)"
              value={fee}
              onChange={setFee}
              error={feeOk ? undefined : 'A percentage from 0 to 100.'}
            />
          </div>
        ) : deal === 'fixed_rent' ? (
          <div className="max-w-[240px]">
            <TextField
              label={`Rent a month (${currency})`}
              value={rent}
              onChange={setRent}
              placeholder="1300.00"
              error={rent.trim() ? rentParsed.error : undefined}
            />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[13px] text-slate">From</p>
            <MonthPicker value={from} onChange={setFrom} />
            <p className="mt-1 text-[12px] text-mist">Earlier months keep the terms they had.</p>
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] text-slate">
            From the contract
            <select
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="h-10 rounded-lg border border-edge bg-white px-2.5 text-[14px] text-ink"
            >
              <option value="">No contract on file</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.signedOn ? `, signed ${shortDate(`${c.signedOn}T12:00:00`)}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Choice<MaintenanceBy>
          label="Repairs"
          value={maintenance}
          onChange={setMaintenance}
          options={[
            [
              'company',
              'We arrange them',
              deal === 'fixed_rent' ? 'At our cost, on a rent deal' : 'Charged to the owner, with receipts',
            ],
            ['owner', 'The owner arranges them', 'We log the job and pass it on; no cost here'],
          ]}
        />
        <div className="max-w-[240px]">
          <TextField
            label={`A clean costs us (${currency})`}
            value={cleaning}
            onChange={setCleaning}
            placeholder="45.00"
            error={cleaning.trim() ? cleaningParsed.error : undefined}
            hint="Logged as our cost each time a clean is done. The guest’s cleaning fee pays for it."
          />
        </div>

        <section className="flex flex-col gap-4 border-t border-hairline pt-5">
          <h3 className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <IconLock size={15} stroke={1.75} aria-hidden /> Who is paid
          </h3>
          {!seePayees ? (
            <p className="text-[13.5px] text-slate">Only admins and accounts see who is paid and where.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Pay to"
                  value={payeeName}
                  onChange={setPayeeName}
                  max={120}
                  placeholder="Name on the account"
                />
                <TextField
                  label="Reference"
                  value={reference}
                  onChange={setReference}
                  max={60}
                  placeholder="Optional"
                />
              </div>
              {home.payee?.hasBank ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-paper px-3.5 py-2.5 text-[14px]">
                  {opened ? (
                    <span className="tnum text-ink">
                      {opened.sortCode.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3')} · {opened.accountNumber}
                    </span>
                  ) : (
                    <span className="text-slate">Account ending {home.payee.accountHint}</span>
                  )}
                  {!opened ? (
                    <button
                      type="button"
                      className="action"
                      disabled={bank.isPending}
                      onClick={() => bank.mutate(home.id)}
                    >
                      Show
                    </button>
                  ) : null}
                </div>
              ) : null}
              {canWritePayee ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={home.payee?.hasBank ? 'New sort code' : 'Sort code'}
                    value={sortCode}
                    onChange={setSortCode}
                    placeholder="12-34-56"
                    autoComplete="off"
                  />
                  <TextField
                    label={home.payee?.hasBank ? 'New account number' : 'Account number'}
                    value={account}
                    onChange={setAccount}
                    placeholder="12345678"
                    autoComplete="off"
                    error={bankOk ? undefined : 'Six digits for the sort code, 6 to 10 for the account.'}
                  />
                </div>
              ) : null}
              <p className="text-[12px] text-mist">
                Sealed before it’s saved; only admins and accounts can show it.
              </p>
            </>
          )}
        </section>

        {home.history.length > 1 ? (
          <section className="border-t border-hairline pt-5">
            <h3 className="mb-2 text-[13px] text-slate">Earlier terms</h3>
            <ul className="text-[13.5px] text-slate">
              {home.history.map((h) => (
                <li key={h.id}>
                  From {monthName(h.from)}: <span className="text-ink">{dealText(h, ownerFee, money)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {save.error || bank.error ? <Notice tone="urgent">{explain(save.error ?? bank.error)}</Notice> : null}
      </div>
    </Sheet>
  );
}

function ContractsSection({
  ownerId,
  contracts,
  write,
}: {
  ownerId: string;
  contracts: Contract[];
  write: boolean;
}) {
  const { orgId } = useCurrentWorkspace();
  const token = useToken();
  const remove = useRemoveContract(orgId, ownerId);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Contract | 'new' | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (c: Contract) => {
    setOpening(c.id);
    setError(null);
    try {
      const { url } = await contractLink(token as string, orgId, ownerId, c.id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(explain(e));
    } finally {
      setOpening(null);
    }
  };
  return (
    <section aria-labelledby="contracts" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="contracts" className="text-[20px] font-semibold tracking-[-0.015em] text-ink">
          Contracts
        </h2>
        {write ? <Button onClick={() => setEditing('new')}>Add a contract</Button> : null}
      </div>
      {contracts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline px-5 py-6 text-[14px] text-slate">
          No contract on file. Upload the signed management agreement so the terms above can point to it.
        </p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-canvas">
          {contracts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[14px]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <IconFileText size={18} stroke={1.6} className="shrink-0 text-slate" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{c.title}</span>
                  <span className="block text-[12.5px] text-slate">
                    {c.signedOn ? `Signed ${shortDate(`${c.signedOn}T12:00:00`)}` : 'Date not given'}
                    {c.endsOn ? ` · runs to ${shortDate(`${c.endsOn}T12:00:00`)}` : ''}
                    {c.sharedWithOwner ? ' · the owner sees it' : ''}
                  </span>
                </span>
              </span>
              <span className="flex gap-1">
                {c.file ? (
                  <button
                    type="button"
                    className="action"
                    disabled={opening === c.id}
                    onClick={() => void open(c)}
                  >
                    Open
                  </button>
                ) : (
                  <span className="text-[12.5px] text-pending-text">No file yet</span>
                )}
                {write ? (
                  <>
                    <button type="button" className="action" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="action action-urgent -mr-2.5"
                      disabled={remove.isPending}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Remove ${c.title}?`,
                            body: 'The file goes too. Terms that point to it keep their figures.',
                            action: 'Remove contract',
                            tone: 'urgent',
                          })
                        )
                          remove.mutate(c.id);
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-3">
          <Notice tone="urgent">{error}</Notice>
        </div>
      ) : null}
      {editing ? (
        <ContractSheet
          ownerId={ownerId}
          contract={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function ContractSheet({
  ownerId,
  contract,
  onClose,
}: {
  ownerId: string;
  contract: Contract | null;
  onClose(): void;
}) {
  const { orgId } = useCurrentWorkspace();
  const save = useSaveContract(orgId, ownerId);
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(contract?.title ?? 'Management agreement');
  const [signedOn, setSignedOn] = useState(contract?.signedOn ?? '');
  const [startsOn, setStartsOn] = useState(contract?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(contract?.endsOn ?? '');
  const [shared, setShared] = useState(contract?.sharedWithOwner ?? true);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const datesOk = !startsOn || !endsOn || endsOn >= startsOn;
  return (
    <Sheet
      title={contract ? contract.title : 'Add a contract'}
      subtitle="The signed agreement, as a PDF or a photo"
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!title.trim() || !datesOk || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  id: contract?.id,
                  body: {
                    title: title.trim(),
                    signedOn: signedOn || null,
                    startsOn: startsOn || null,
                    endsOn: endsOn || null,
                    sharedWithOwner: shared,
                  },
                  file,
                },
                { onSuccess: onClose },
              )
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField label="Title" value={title} onChange={setTitle} max={120} />
        <div className="grid gap-4 sm:grid-cols-3">
          <DateField label="Signed" value={signedOn} onChange={setSignedOn} today={today} />
          <DateField label="Starts" value={startsOn} onChange={setStartsOn} today={today} />
          <DateField label="Ends or renews" value={endsOn} onChange={setEndsOn} today={today} />
        </div>
        {!datesOk ? <Notice tone="urgent">It ends before it starts.</Notice> : null}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-hairline px-4 py-3 text-[14px]">
          <IconFileText size={18} stroke={1.6} className="text-slate" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-slate">
            {file ? file.name : contract?.file ? contract.file.name : 'No file chosen'}
          </span>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button onClick={() => input.current?.click()}>
            {contract?.file || file ? 'Replace file' : 'Choose file'}
          </Button>
        </div>
        <Toggle label="The owner sees it in their log-in" checked={shared} onChange={setShared} />
        {config.demo ? (
          <p className="text-[12px] text-mist">In the demo the file stays in this browser.</p>
        ) : null}
        {save.error ? <Notice tone="urgent">{explain(save.error)}</Notice> : null}
      </div>
    </Sheet>
  );
}
