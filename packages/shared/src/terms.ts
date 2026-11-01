import { z } from 'zod';
import { EXPENSE_RECEIPT_MAX_BYTES } from './owners.ts';
import { IsoDate, Uuid } from './schemas.ts';

/**
 * What each owner signed and what each home pays them (1 Nov 2026).
 *
 * A contract is the signed management agreement, uploaded. Each home has terms from a month on:
 * a percentage of what the stay brings in, a fixed monthly rent, or no fee (a board member); who
 * arranges maintenance; and the contract they come from. Who is paid for the home, and to which
 * account, is kept sealed and shown to admins and accounts only.
 */

export const DEALS = ['percentage', 'fixed_rent', 'no_fee'] as const;
export type Deal = (typeof DEALS)[number];
export const DEAL_LABELS: Record<Deal, string> = {
  percentage: 'Percentage fee',
  fixed_rent: 'Fixed monthly rent',
  no_fee: 'No management fee (board)',
};

export const MAINTENANCE_BY = ['company', 'owner'] as const;
export type MaintenanceBy = (typeof MAINTENANCE_BY)[number];

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM');

export const HomeTermsSchema = z.object({
  id: Uuid,
  /** YYYY-MM: the terms apply from the start of this month. */
  from: z.string(),
  deal: z.enum(DEALS),
  feeBasisPoints: z.number().int().nullable(),
  rentMinor: z.number().int().nullable(),
  maintenanceBy: z.enum(MAINTENANCE_BY),
  contractId: Uuid.nullable(),
});
export type HomeTerms = z.infer<typeof HomeTermsSchema>;

export const HomeTermsInputSchema = z
  .object({
    from: Month,
    deal: z.enum(DEALS),
    feeBasisPoints: z.number().int().min(0).max(10_000).nullable().optional(),
    rentMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
    maintenanceBy: z.enum(MAINTENANCE_BY),
    contractId: Uuid.nullable().optional(),
  })
  .refine((t) => t.deal !== 'percentage' || typeof t.feeBasisPoints === 'number', {
    message: 'A percentage deal needs its fee.',
    path: ['feeBasisPoints'],
  })
  .refine((t) => t.deal !== 'fixed_rent' || typeof t.rentMinor === 'number', {
    message: 'A rent deal needs the monthly rent.',
    path: ['rentMinor'],
  });
export type HomeTermsInput = z.infer<typeof HomeTermsInputSchema>;

export const PayeeSchema = z.object({
  payeeName: z.string(),
  reference: z.string().nullable(),
  /** The account number's last digits, so accounts can be told apart without opening them. */
  accountHint: z.string().nullable(),
  hasBank: z.boolean(),
});
export type Payee = z.infer<typeof PayeeSchema>;

const SortCode = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'A sort code is six digits, like 12-34-56.'));
const AccountNumber = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6,10}$/, 'An account number is 6 to 10 digits.'));

export const PayeeInputSchema = z.object({
  payeeName: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(60).optional(),
  /** Both, or neither to keep the account already saved. */
  sortCode: SortCode.optional(),
  accountNumber: AccountNumber.optional(),
});
export type PayeeInput = z.infer<typeof PayeeInputSchema>;

export const BankDetailsSchema = z.object({ sortCode: z.string(), accountNumber: z.string() });
export type BankDetails = z.infer<typeof BankDetailsSchema>;

export const CONTRACT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const ContractSchema = z.object({
  id: Uuid,
  title: z.string(),
  signedOn: IsoDate.nullable(),
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
  sharedWithOwner: z.boolean(),
  file: z.object({ name: z.string(), contentType: z.string(), bytes: z.number().int() }).nullable(),
  createdAt: z.string(),
});
export type Contract = z.infer<typeof ContractSchema>;

export const ContractInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  signedOn: IsoDate.nullable().optional(),
  startsOn: IsoDate.nullable().optional(),
  endsOn: IsoDate.nullable().optional(),
  sharedWithOwner: z.boolean().optional(),
});
export type ContractInput = z.infer<typeof ContractInputSchema>;

export const ContractUploadSchema = z.object({
  contentType: z.enum(CONTRACT_TYPES),
  bytes: z.number().int().positive().max(EXPENSE_RECEIPT_MAX_BYTES),
});
export const ContractRegisterSchema = z.object({
  path: z.string().min(1).max(300),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(CONTRACT_TYPES),
  bytes: z.number().int().positive().max(EXPENSE_RECEIPT_MAX_BYTES),
});

export const FileLinkSchema = z.object({ url: z.string() });

/** An owner's set-up: their contracts, and each home's terms, payee and cleaning cost. */
export const OwnerSetupSchema = z.object({
  contracts: z.array(ContractSchema),
  homes: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      /** In force this month; null when none are set (the owner's own fee applies). */
      terms: HomeTermsSchema.nullable(),
      /** Every change, newest first. */
      history: z.array(HomeTermsSchema),
      /** Null for people who may not see who is paid. */
      payee: PayeeSchema.nullable(),
      cleaningCostMinor: z.number().int().nullable(),
    }),
  ),
  /** What's still to do: no contract on file, homes without terms, homes without a payee. */
  missing: z.object({
    contract: z.boolean(),
    homesWithoutTerms: z.number().int(),
    homesWithoutPayee: z.number().int().nullable(),
  }),
});
export type OwnerSetup = z.infer<typeof OwnerSetupSchema>;

export const CleaningCostSchema = z.object({
  cleaningCostMinor: z.number().int().min(0).max(10_000_000).nullable(),
});

export const RefundForSchema = z.enum(['stay', 'cleaning']);
export type RefundFor = z.infer<typeof RefundForSchema>;

export const MonthParamSchema = Month;
