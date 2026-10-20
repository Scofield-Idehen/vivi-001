import { z } from 'zod';

// Not from schemas.ts: that file includes these fields on the property detail.
const Uuid = z.uuid();

/**
 * Custom fields: the team's own details on every property, as Guesty has them. A check-in
 * instructions link, a lock code, the cleaning policy, a note for the team. Defined once for the
 * workspace, with a value on each property. Message templates draw on them later (Phase 2).
 */
export const FIELD_KINDS = ['text', 'long_text', 'link', 'secret'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Short text',
  long_text: 'Long text',
  link: 'Link',
  secret: 'Secret',
};

export const FIELD_KIND_HINTS: Record<FieldKind, string> = {
  text: 'A line, such as a policy name or a parking space.',
  long_text: 'A paragraph or more, such as a cleaning policy.',
  link: 'A web address, such as check-in instructions in a shared document.',
  secret:
    'A lock code, key-safe code or Wi-Fi password: stored encrypted, shown only on request, and never to accounts or V-01 support.',
};

export const FIELD_NAME_MAX = 60;
export const FIELD_VALUE_MAX = 4000;
export const FIELDS_MAX = 40;

export const CustomFieldSchema = z.object({
  id: Uuid,
  name: z.string(),
  kind: z.enum(FIELD_KINDS),
  position: z.number().int(),
  /** Shown on the guest's stay page. A secret appears there only from the day of arrival until departure. */
  guestVisible: z.boolean(),
  /** Shown to the field team inside their job at a property, on the job's day. */
  crewVisible: z.boolean(),
});
export type CustomField = z.infer<typeof CustomFieldSchema>;

export const CustomFieldListSchema = z.object({ fields: z.array(CustomFieldSchema) });
export type CustomFieldList = z.infer<typeof CustomFieldListSchema>;

export const CustomFieldCreateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_NAME_MAX),
  kind: z.enum(FIELD_KINDS),
  guestVisible: z.boolean().optional(),
  crewVisible: z.boolean().optional(),
});
export type CustomFieldCreate = z.infer<typeof CustomFieldCreateSchema>;

export const CustomFieldUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(FIELD_NAME_MAX).optional(),
    position: z.number().int().min(0).optional(),
    guestVisible: z.boolean().optional(),
    crewVisible: z.boolean().optional(),
  })
  .refine((u) => Object.values(u).some((v) => v !== undefined), {
    message: 'Nothing to change',
  });
export type CustomFieldUpdate = z.infer<typeof CustomFieldUpdateSchema>;

/** A field with its value on one property. A secret the caller may not see comes as hidden. */
export const PropertyFieldSchema = CustomFieldSchema.extend({
  value: z.string().nullable(),
  /** The property has a value, but this caller can't see it. */
  hidden: z.boolean(),
});
export type PropertyField = z.infer<typeof PropertyFieldSchema>;

const Value = z.string().trim().max(FIELD_VALUE_MAX);

/** Values by field id. An empty string clears the field. Fields not named are left as they are. */
export const PropertyFieldsUpdateSchema = z.object({
  values: z.record(Uuid, Value).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' }),
});
export type PropertyFieldsUpdate = z.infer<typeof PropertyFieldsUpdateSchema>;

/** A link field must hold a web address. */
export function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
