import { z } from 'zod';
import { IsoDate, Uuid } from './schemas.ts';

/**
 * Owners and expenses (built 30 Oct 2026). An owner is a person or company whose homes the team
 * runs, with the management fee they pay. An expense is money spent on a home (or on the business),
 * charged to the owner or kept by the company, with its receipt kept as uploaded. An owner's month
 * shows their homes' earnings, the fee and the expenses charged to them: the statement's draft.
 */

// Owners -----------------------------------------------------------------------------------------

export const OwnerSchema = z.object({
  id: Uuid,
  name: z.string(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** The management fee, in hundredths of a percent: 1800 is 18%. */
  feeBasisPoints: z.number().int(),
  notes: z.string().nullable(),
  homes: z.array(z.object({ id: Uuid, name: z.string() })),
  createdAt: z.string(),
});
export type Owner = z.infer<typeof OwnerSchema>;

export const OwnerListSchema = z.object({
  owners: z.array(OwnerSchema),
  /** Homes nobody is down as owning yet. */
  unowned: z.array(z.object({ id: Uuid, name: z.string() })),
});
export type OwnerList = z.infer<typeof OwnerListSchema>;

const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const OwnerInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: Text(120),
  email: z
    .union([z.email().max(200), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  phone: Text(40),
  feeBasisPoints: z.number().int().min(0).max(10_000).optional(),
  notes: Text(2000),
});
export type OwnerInput = z.input<typeof OwnerInputSchema>;

export const OwnerUpdateSchema = OwnerInputSchema.partial().refine(
  (u) => Object.keys(u).length > 0,
  'Nothing to change',
);
export type OwnerUpdate = z.input<typeof OwnerUpdateSchema>;

export const OwnerHomesSchema = z.object({ propertyIds: z.array(Uuid).max(500) });

export const OwnerMonthQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM')
    .optional(),
});

// Expenses ---------------------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  'cleaning',
  'laundry',
  'repairs',
  'supplies',
  'utilities',
  'furnishing',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  cleaning: 'Cleaning',
  laundry: 'Laundry and linen',
  repairs: 'Repairs and maintenance',
  supplies: 'Supplies and restocking',
  utilities: 'Utilities and bills',
  furnishing: 'Furnishing',
  other: 'Other',
};

/** Who bears it: charged on to the home's owner, or kept by the company. */
export const EXPENSE_CHARGES = ['owner', 'company'] as const;
export type ExpenseCharge = (typeof EXPENSE_CHARGES)[number];

export const EXPENSE_RECEIPT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;
export const EXPENSE_RECEIPT_MAX_BYTES = 25 * 1024 * 1024;

export const ExpenseSchema = z.object({
  id: Uuid,
  spentOn: IsoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string(),
  vendor: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: z.string(),
  chargeTo: z.enum(EXPENSE_CHARGES),
  propertyId: Uuid.nullable(),
  propertyName: z.string().nullable(),
  ownerName: z.string().nullable(),
  claimId: Uuid.nullable(),
  receipt: z
    .object({ fileName: z.string(), contentType: z.string(), bytes: z.number().int(), url: z.string() })
    .nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const ExpenseListQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM')
    .optional(),
  propertyId: Uuid.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
});

export const ExpenseListSchema = z.object({
  month: z.string(),
  currency: z.string(),
  expenses: z.array(ExpenseSchema),
  totalMinor: z.number().int(),
  ownerMinor: z.number().int(),
  companyMinor: z.number().int(),
  byCategory: z.array(z.object({ category: z.enum(EXPENSE_CATEGORIES), amountMinor: z.number().int() })),
});
export type ExpenseList = z.infer<typeof ExpenseListSchema>;

export const ExpenseInputSchema = z.object({
  spentOn: IsoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(1).max(300),
  vendor: Text(120),
  amountMinor: z.number().int().min(0).max(100_000_000),
  chargeTo: z.enum(EXPENSE_CHARGES).default('owner'),
  propertyId: Uuid.nullable().optional(),
  claimId: Uuid.nullable().optional(),
});
export type ExpenseInput = z.input<typeof ExpenseInputSchema>;

export const ExpenseUpdateSchema = ExpenseInputSchema.partial().refine(
  (u) => Object.keys(u).length > 0,
  'Nothing to change',
);
export type ExpenseUpdate = z.input<typeof ExpenseUpdateSchema>;

export const ExpenseReceiptUploadSchema = z.object({
  contentType: z.enum(EXPENSE_RECEIPT_TYPES),
  bytes: z.number().int().positive().max(EXPENSE_RECEIPT_MAX_BYTES),
});

export const ExpenseReceiptRegisterSchema = z.object({
  path: z.string().min(1).max(300),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(EXPENSE_RECEIPT_TYPES),
  bytes: z.number().int().positive().max(EXPENSE_RECEIPT_MAX_BYTES),
});

/** An owner's month: what each home earned, the fee, the expenses charged to them, and what's left. */
export const OwnerMonthSchema = z.object({
  owner: OwnerSchema,
  month: z.string(),
  currency: z.string(),
  homes: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      nights: z.number().int(),
      earnedMinor: z.number().int(),
      expensesMinor: z.number().int(),
    }),
  ),
  earnedMinor: z.number().int(),
  feeMinor: z.number().int(),
  expensesMinor: z.number().int(),
  /** Earned, less the fee and the expenses charged to the owner. */
  netMinor: z.number().int(),
  expenses: z.array(ExpenseSchema),
});
export type OwnerMonth = z.infer<typeof OwnerMonthSchema>;
