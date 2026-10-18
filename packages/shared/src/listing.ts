import { z } from 'zod';

/**
 * What a property's listing is made of, beyond its basics: amenities, rooms and beds, photos,
 * descriptions, house rules, booking rules and fees. V-01 keeps the master copy, in a vocabulary
 * richer than any one channel's, and maps it down to each channel's nearest equivalent.
 */

// Amenities ------------------------------------------------------------------------------------

export const AMENITY_CATEGORIES = [
  'standout',
  'essentials',
  'kitchen',
  'bathroom',
  'bedroom_laundry',
  'entertainment',
  'family',
  'heating_cooling',
  'internet_work',
  'parking_outside',
  'safety',
  'accessibility',
  'services',
] as const;
export type AmenityCategory = (typeof AMENITY_CATEGORIES)[number];

export const AMENITY_CATEGORY_LABELS: Record<AmenityCategory, string> = {
  standout: 'Standout features',
  essentials: 'Essentials',
  kitchen: 'Kitchen and dining',
  bathroom: 'Bathroom',
  bedroom_laundry: 'Bedroom and laundry',
  entertainment: 'Entertainment',
  family: 'Family',
  heating_cooling: 'Heating and cooling',
  internet_work: 'Internet and work',
  parking_outside: 'Parking and outside',
  safety: 'Safety',
  accessibility: 'Accessibility',
  services: 'Services',
};

export interface Amenity {
  code: string;
  label: string;
  category: AmenityCategory;
}

const amenities = (category: AmenityCategory, list: [code: string, label: string][]): Amenity[] =>
  list.map(([code, label]) => ({ code, label, category }));

/**
 * Stored as text codes, so the list can grow without a migration. Standout features are the
 * ones guests search and filter for; the listing shows them first.
 */
export const AMENITIES: readonly Amenity[] = [
  ...amenities('standout', [
    ['hot_tub', 'Hot tub'],
    ['pool', 'Swimming pool'],
    ['sauna', 'Sauna'],
    ['sea_view', 'Sea view'],
    ['countryside_view', 'Countryside view'],
    ['mountain_view', 'Mountain view'],
    ['lake_view', 'Lake or river view'],
    ['beach_access', 'Beach access'],
    ['waterfront', 'Waterfront'],
    ['log_burner', 'Log burner'],
    ['open_fire', 'Open fire'],
    ['garden', 'Garden'],
    ['bbq', 'Barbecue'],
    ['fire_pit', 'Fire pit'],
    ['games_room', 'Games room'],
    ['home_cinema', 'Home cinema'],
    ['ev_charger', 'EV charger'],
    ['gym', 'Gym'],
  ]),
  ...amenities('essentials', [
    ['wifi', 'Wi-Fi'],
    ['towels', 'Towels'],
    ['bed_linen', 'Bed linen'],
    ['toiletries', 'Toiletries'],
    ['hairdryer', 'Hairdryer'],
    ['iron', 'Iron'],
    ['hangers', 'Hangers'],
    ['hot_water', 'Hot water'],
  ]),
  ...amenities('kitchen', [
    ['kitchen', 'Kitchen'],
    ['fridge', 'Fridge'],
    ['freezer', 'Freezer'],
    ['oven', 'Oven'],
    ['hob', 'Hob'],
    ['microwave', 'Microwave'],
    ['dishwasher', 'Dishwasher'],
    ['kettle', 'Kettle'],
    ['coffee_machine', 'Coffee machine'],
    ['toaster', 'Toaster'],
    ['cooking_basics', 'Pots, pans, oil, salt and pepper'],
    ['crockery_cutlery', 'Crockery and cutlery'],
    ['dining_table', 'Dining table'],
  ]),
  ...amenities('bathroom', [
    ['bath', 'Bath'],
    ['walk_in_shower', 'Walk-in shower'],
    ['shampoo', 'Shampoo and shower gel'],
    ['heated_towel_rail', 'Heated towel rail'],
  ]),
  ...amenities('bedroom_laundry', [
    ['washing_machine', 'Washing machine'],
    ['tumble_dryer', 'Tumble dryer'],
    ['drying_rack', 'Clothes airer'],
    ['wardrobe', 'Wardrobe or drawers'],
    ['blackout_blinds', 'Blackout blinds or curtains'],
    ['extra_pillows', 'Extra pillows and blankets'],
  ]),
  ...amenities('entertainment', [
    ['tv', 'TV'],
    ['streaming', 'Streaming services'],
    ['sound_system', 'Speaker or sound system'],
    ['board_games', 'Board games'],
    ['books', 'Books'],
    ['games_console', 'Games console'],
  ]),
  ...amenities('family', [
    ['cot', 'Cot'],
    ['high_chair', 'High chair'],
    ['stair_gates', 'Stair gates'],
    ['childrens_toys', "Children's books and toys"],
    ['outdoor_play', 'Outdoor play area'],
  ]),
  ...amenities('heating_cooling', [
    ['central_heating', 'Central heating'],
    ['underfloor_heating', 'Underfloor heating'],
    ['air_conditioning', 'Air conditioning'],
    ['fans', 'Fans'],
  ]),
  ...amenities('internet_work', [
    ['fast_wifi', 'Fast Wi-Fi, 100 Mbps or more'],
    ['workspace', 'Desk for working'],
  ]),
  ...amenities('parking_outside', [
    ['free_parking', 'Free parking on the property'],
    ['street_parking', 'Free street parking'],
    ['paid_parking', 'Paid parking nearby'],
    ['garage', 'Garage'],
    ['patio', 'Patio or balcony'],
    ['outdoor_furniture', 'Outdoor furniture'],
    ['bike_storage', 'Bike storage'],
    ['boot_room', 'Boot room'],
  ]),
  ...amenities('safety', [
    ['smoke_alarm', 'Smoke alarm'],
    ['co_alarm', 'Carbon monoxide alarm'],
    ['fire_extinguisher', 'Fire extinguisher'],
    ['fire_blanket', 'Fire blanket'],
    ['first_aid_kit', 'First aid kit'],
    ['outdoor_cameras', 'Security cameras outside'],
  ]),
  ...amenities('accessibility', [
    ['step_free_entrance', 'Step-free entrance'],
    ['ground_floor_bedroom', 'Bedroom on the ground floor'],
    ['step_free_shower', 'Step-free shower'],
    ['grab_rails', 'Grab rails in the bathroom'],
    ['wide_doorways', 'Wide doorways'],
    ['lift', 'Lift'],
  ]),
  ...amenities('services', [
    ['self_check_in', 'Self check-in'],
    ['luggage_drop', 'Luggage drop-off'],
    ['long_stays', 'Long stays allowed'],
    ['cleaning_during_stay', 'Cleaning during the stay'],
  ]),
];

const AMENITY_BY_CODE = new Map(AMENITIES.map((a) => [a.code, a]));

export function amenity(code: string): Amenity | undefined {
  return AMENITY_BY_CODE.get(code);
}

export function isAmenityCode(code: string): boolean {
  return AMENITY_BY_CODE.has(code);
}

/** A set of amenity codes, each one known, each once. */
export const AmenityCodesSchema = z
  .array(z.string().refine(isAmenityCode, 'Unknown amenity'))
  .max(200)
  .transform((codes) => [...new Set(codes)]);

// Rooms and beds -------------------------------------------------------------------------------

export const ROOM_KINDS = ['bedroom', 'living_room', 'other'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  bedroom: 'Bedroom',
  living_room: 'Living room',
  other: 'Other space',
};

export const BED_TYPES = [
  'single',
  'small_double',
  'double',
  'king',
  'super_king',
  'bunk_bed',
  'sofa_bed',
  'floor_mattress',
  'cot',
] as const;
export type BedType = (typeof BED_TYPES)[number];

export const BED_TYPE_LABELS: Record<BedType, string> = {
  single: 'Single',
  small_double: 'Small double',
  double: 'Double',
  king: 'King',
  super_king: 'Super king',
  bunk_bed: 'Bunk bed',
  sofa_bed: 'Sofa bed',
  floor_mattress: 'Floor mattress',
  cot: 'Cot',
};

/** How many people each bed sleeps; a cot is for an infant, so it adds no guest. */
export const BED_SLEEPS: Record<BedType, number> = {
  single: 1,
  small_double: 2,
  double: 2,
  king: 2,
  super_king: 2,
  bunk_bed: 2,
  sofa_bed: 2,
  floor_mattress: 1,
  cot: 0,
};

export const BedSchema = z.object({
  type: z.enum(BED_TYPES),
  count: z.number().int().min(1).max(20),
});
export type Bed = z.infer<typeof BedSchema>;

export const RoomInputSchema = z.object({
  /** An existing room keeps its id, so photos tagged to it stay tagged. */
  id: z.uuid().optional(),
  kind: z.enum(ROOM_KINDS),
  name: z.string().trim().max(60).nullable().optional(),
  beds: z.array(BedSchema).max(BED_TYPES.length),
  /** An en-suite or a bathroom only this room uses. */
  privateBathroom: z.boolean().default(false),
});
export type RoomInput = z.input<typeof RoomInputSchema>;

export const RoomsUpdateSchema = z.object({ rooms: z.array(RoomInputSchema).max(30) });
export type RoomsUpdate = z.input<typeof RoomsUpdateSchema>;

export const RoomSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ROOM_KINDS),
  name: z.string().nullable(),
  beds: z.array(BedSchema),
  privateBathroom: z.boolean(),
});
export type Room = z.infer<typeof RoomSchema>;

/** Beds that count towards the total a channel shows: every bed but a cot. */
export function countBeds(rooms: readonly { beds: readonly Bed[] }[]): number {
  return rooms.reduce(
    (total, room) => total + room.beds.filter((b) => b.type !== 'cot').reduce((n, b) => n + b.count, 0),
    0,
  );
}

/** How many people the beds sleep, to check against the guest count. */
export function countSleeps(rooms: readonly { beds: readonly Bed[] }[]): number {
  return rooms.reduce(
    (total, room) => total + room.beds.reduce((n, b) => n + BED_SLEEPS[b.type] * b.count, 0),
    0,
  );
}

// Photos ---------------------------------------------------------------------------------------

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Larger files are resized in the browser before they upload. */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
/** Enough for any channel; Channex itself keeps 30 per property. */
export const PHOTO_MAX_COUNT = 50;
/** Airbnb asks for at least five photos before a listing goes live. */
export const PHOTO_MIN_TO_LIST = 5;

export const PhotoSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  caption: z.string().nullable(),
  position: z.number().int(),
  roomId: z.uuid().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Photo = z.infer<typeof PhotoSchema>;

export const PhotoUploadRequestSchema = z.object({
  contentType: z.enum(PHOTO_TYPES),
  bytes: z.number().int().positive().max(PHOTO_MAX_BYTES),
});
export type PhotoUploadRequest = z.infer<typeof PhotoUploadRequestSchema>;

/** Where the browser sends the file itself; then it registers the photo with `path`. */
export const PhotoUploadTicketSchema = z.object({
  path: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});
export type PhotoUploadTicket = z.infer<typeof PhotoUploadTicketSchema>;

export const PhotoRegisterSchema = z.object({
  path: z.string().min(1).max(300),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  caption: z.string().trim().max(200).nullable().optional(),
});
export type PhotoRegister = z.input<typeof PhotoRegisterSchema>;

export const PhotoUpdateSchema = z
  .object({
    caption: z.string().trim().max(200).nullable().optional(),
    roomId: z.uuid().nullable().optional(),
  })
  .refine((p) => p.caption !== undefined || p.roomId !== undefined, 'Nothing to change');
export type PhotoUpdate = z.input<typeof PhotoUpdateSchema>;

export const PhotoOrderSchema = z.object({ photoIds: z.array(z.uuid()).min(1).max(PHOTO_MAX_COUNT) });

export const AmenitiesUpdateSchema = z.object({ amenities: z.array(z.string()).max(200) });

// Rules and policies ---------------------------------------------------------------------------

export const CHECK_IN_METHODS = ['smart_lock', 'keypad', 'lockbox', 'host_greets', 'building_staff'] as const;
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];

export const CHECK_IN_METHOD_LABELS: Record<CheckInMethod, string> = {
  smart_lock: 'Smart lock',
  keypad: 'Keypad',
  lockbox: 'Lockbox',
  host_greets: 'Someone meets guests',
  building_staff: 'Building staff',
};

/** V-01's policy; each channel applies its nearest equivalent. */
export const CANCELLATION_POLICIES = ['flexible', 'moderate', 'firm', 'strict', 'non_refundable'] as const;
export type CancellationPolicy = (typeof CANCELLATION_POLICIES)[number];

export const CANCELLATION_POLICY_LABELS: Record<CancellationPolicy, { label: string; description: string }> =
  {
    flexible: { label: 'Flexible', description: 'Full refund up to a day before arrival.' },
    moderate: { label: 'Moderate', description: 'Full refund up to 5 days before arrival.' },
    firm: { label: 'Firm', description: 'Full refund up to 30 days before arrival.' },
    strict: { label: 'Strict', description: 'Half refund up to 7 days before arrival.' },
    non_refundable: { label: 'Non-refundable', description: 'No refund, usually for a lower price.' },
  };

// Limits the channels set ----------------------------------------------------------------------

/** Airbnb cuts titles at 50 characters, so V-01 keeps every title within that. */
export const TITLE_MAX = 50;
/** Airbnb's main description holds 500 characters; longer detail goes in the other sections. */
export const SUMMARY_MAX = 500;
export const SECTION_MAX = 4000;

// Ready for the channels ---------------------------------------------------------------------------

export type ListingSection =
  | 'photos'
  | 'place'
  | 'rooms'
  | 'amenities'
  | 'description'
  | 'address'
  | 'arrival'
  | 'rules'
  | 'booking'
  | 'pricing'
  | 'licence'
  | 'fields'
  | 'channels'
  | 'settings';

export interface ListingCheck {
  section: ListingSection;
  label: string;
  done: boolean;
  /** What to do next, or what is there. */
  note: string;
}

/**
 * What a listing needs before it goes on a channel. Every channel asks for these; the
 * strictest rule wins (Airbnb's five photos and 50-character title).
 */
export function listingChecklist(d: {
  photos: readonly unknown[];
  title: string | null;
  summary: string | null;
  amenities: readonly string[];
  rooms: readonly { beds: readonly Bed[] }[];
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  checkInMethod: string | null;
  priceOwner: string;
  basePriceMinor: number | null;
}): ListingCheck[] {
  const photos = d.photos.length;
  const missingPhotos = Math.max(0, PHOTO_MIN_TO_LIST - photos);
  const address = [d.addressLine1, d.city, d.postcode].filter((part) => part?.trim()).length;
  return [
    {
      section: 'photos',
      label: 'Photos',
      done: missingPhotos === 0,
      note:
        missingPhotos === 0
          ? `${photos} photos`
          : `Add ${missingPhotos} more, at least ${PHOTO_MIN_TO_LIST} in all`,
    },
    {
      section: 'description',
      label: 'Title',
      done: Boolean(d.title?.trim()),
      note: d.title?.trim() ? 'Written' : 'What guests see first',
    },
    {
      section: 'description',
      label: 'Description',
      done: Boolean(d.summary?.trim()),
      note: d.summary?.trim() ? 'Written' : 'A few lines about the place',
    },
    {
      section: 'amenities',
      label: 'Amenities',
      done: d.amenities.length >= 3,
      note: d.amenities.length >= 3 ? `${d.amenities.length} picked` : 'Pick at least three',
    },
    {
      section: 'rooms',
      label: 'Beds in each room',
      done: d.rooms.some((room) => room.beds.length > 0),
      note: d.rooms.length
        ? `${d.rooms.length} ${d.rooms.length === 1 ? 'room' : 'rooms'}`
        : 'Where everyone sleeps',
    },
    {
      section: 'address',
      label: 'Full address',
      done: address === 3,
      note: address === 3 ? 'Street, town and postcode' : 'Street, town and postcode',
    },
    {
      section: 'arrival',
      label: 'How guests get in',
      done: Boolean(d.checkInMethod),
      note: d.checkInMethod ? 'Chosen' : 'Keypad, lockbox or someone meets them',
    },
    {
      section: 'pricing',
      label: 'Nightly price',
      done: d.priceOwner === 'pricelabs' || Boolean(d.basePriceMinor),
      note:
        d.priceOwner === 'pricelabs'
          ? 'From PriceLabs'
          : d.basePriceMinor
            ? 'Set'
            : 'The usual price a night',
    },
  ];
}
