import {
  type AvailabilityUpdate,
  type BookingChannel,
  type BookingRevision,
  ChannelError,
  type ChannelProvider,
  type ExternalPropertyRef,
  type ListingSetup,
  type PushResult,
  type RestrictionUpdate,
  type RevisionStatus,
} from '../provider.ts';
import { ChannexClient, type ChannexConfig, type ChannexEnvelope } from './client.ts';

/** The id Channex gave something it just created. */
function createdId(envelope: ChannexEnvelope<unknown>, what: string): string {
  const data = envelope.data;
  const id = data && typeof data === 'object' && 'id' in data ? data.id : undefined;
  if (typeof id !== 'string' || !id) {
    throw new ChannelError(`Channex made the ${what} but sent back no id for it.`, 'validation');
  }
  return id;
}

/**
 * Channex adapter. Payload shapes follow docs.channex.io (ARI and bookings collections).
 * Not yet certified: Channex certifies on a live screenshare at week 7 (playbook, Section 18).
 */
export class ChannexProvider implements ChannelProvider {
  readonly name = 'channex';
  private readonly client: ChannexClient;

  constructor(config: ChannexConfig | ChannexClient) {
    this.client = config instanceof ChannexClient ? config : new ChannexClient(config);
  }

  async pushAvailability(updates: AvailabilityUpdate[]): Promise<PushResult> {
    if (updates.length === 0) return { taskId: null, warnings: [] };
    const values = updates.map((u) => ({
      property_id: u.ref.externalPropertyId,
      room_type_id: u.ref.externalRoomTypeId,
      date_from: u.dateFrom,
      date_to: u.dateTo,
      availability: u.available,
    }));
    return toPushResult(await this.client.request('POST', '/availability', { values }));
  }

  async pushRestrictions(updates: RestrictionUpdate[]): Promise<PushResult> {
    if (updates.length === 0) return { taskId: null, warnings: [] };
    const values = updates.map((u) => {
      const value: Record<string, unknown> = {
        property_id: u.ref.externalPropertyId,
        rate_plan_id: u.ref.externalRatePlanId,
        date_from: u.dateFrom,
        date_to: u.dateTo,
      };
      // Rates go as whole minor units, which Channex accepts directly (20000 = 200.00).
      if (u.rateMinor !== undefined) value.rate = u.rateMinor;
      if (u.minStayArrival !== undefined) value.min_stay_arrival = u.minStayArrival;
      // Channex reads a longest stay of 0 as no limit.
      if (u.maxStay !== undefined) value.max_stay = u.maxStay ?? 0;
      if (u.closedToArrival !== undefined) value.closed_to_arrival = u.closedToArrival;
      if (u.closedToDeparture !== undefined) value.closed_to_departure = u.closedToDeparture;
      if (u.stopSell !== undefined) value.stop_sell = u.stopSell;
      if (Object.keys(value).length === 4) {
        throw new Error('A restriction update needs at least one restriction or a rate');
      }
      return value;
    });
    return toPushResult(await this.client.request('POST', '/restrictions', { values }));
  }

  async fetchBookingRevisionFeed(
    options: { externalPropertyId?: string; page?: number } = {},
  ): Promise<BookingRevision[]> {
    const params = new URLSearchParams({
      'order[inserted_at]': 'asc',
      'pagination[page]': String(options.page ?? 1),
      'pagination[limit]': '100',
    });
    if (options.externalPropertyId) params.set('filter[property_id]', options.externalPropertyId);
    const envelope = await this.client.request<RevisionResource[]>(
      'GET',
      `/booking_revisions/feed?${params}`,
    );
    return (envelope.data ?? []).map(toRevision);
  }

  async acknowledgeBookingRevision(revisionId: string): Promise<void> {
    await this.client.request('POST', `/booking_revisions/${encodeURIComponent(revisionId)}/ack`);
  }

  async createListing(setup: ListingSetup): Promise<ExternalPropertyRef> {
    const property = await this.client.request('POST', '/properties', {
      property: {
        title: setup.title,
        currency: setup.currency,
        country: setup.countryCode,
        timezone: setup.timeZone,
        ...(setup.city ? { city: setup.city } : {}),
        ...(setup.address ? { address: setup.address } : {}),
        ...(setup.postcode ? { zip_code: setup.postcode } : {}),
        settings: {
          // Channex closes a night itself the moment a booking arrives, so it is never sold twice
          // while V-01 is catching up, or down (recovery runbook).
          allow_availability_autoupdate_on_confirmation: true,
          allow_availability_autoupdate_on_modification: true,
          allow_availability_autoupdate_on_cancellation: true,
          // V-01's minimum stay applies to the night a guest arrives.
          min_stay_type: 'arrival',
        },
      },
    });
    const propertyId = createdId(property, 'property');
    try {
      const roomType = await this.client.request('POST', '/room_types', {
        room_type: {
          property_id: propertyId,
          title: 'Whole place',
          count_of_rooms: 1,
          occ_adults: setup.maxGuests,
          occ_children: 0,
          occ_infants: 0,
          default_occupancy: setup.maxGuests,
          room_kind: 'room',
        },
      });
      const roomTypeId = createdId(roomType, 'unit');
      const ratePlan = await this.client.request('POST', '/rate_plans', {
        rate_plan: {
          title: 'Standard',
          property_id: propertyId,
          room_type_id: roomTypeId,
          currency: setup.currency,
          sell_mode: 'per_room',
          rate_mode: 'manual',
          options: [{ occupancy: setup.maxGuests, is_primary: true, rate: 0 }],
        },
      });
      // Channex puts a new property in the account's default group; the operator's own group is
      // what keeps operators apart, so the property joins it too.
      if (setup.groupId) {
        await this.client.request(
          'POST',
          `/groups/${encodeURIComponent(setup.groupId)}/properties/${encodeURIComponent(propertyId)}`,
        );
      }
      return {
        externalPropertyId: propertyId,
        externalRoomTypeId: roomTypeId,
        externalRatePlanId: createdId(ratePlan, 'rate plan'),
      };
    } catch (error) {
      // Leave nothing half made. If even that fails, say which property is left over.
      const cleanedUp = await this.client
        .request('DELETE', `/properties/${encodeURIComponent(propertyId)}`)
        .then(() => true)
        .catch(() => false);
      if (error instanceof ChannelError) {
        throw new ChannelError(
          cleanedUp
            ? `${error.message} The property it had made is removed again.`
            : `${error.message} Property ${propertyId} was left in Channex: remove it there.`,
          error.kind,
          error.status,
          error.retryAfterMs,
        );
      }
      throw error;
    }
  }

  async createGroup(title: string): Promise<string> {
    const group = await this.client.request('POST', '/groups', { group: { title: title.slice(0, 255) } });
    return createdId(group, 'group');
  }

  parseRevision(raw: unknown): BookingRevision {
    if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') {
      throw new Error('Not a Channex booking revision: it has no id');
    }
    return toRevision(raw as RevisionResource);
  }
}

interface Occupancy {
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
}

interface RevisionResource {
  id: string;
  type?: string;
  attributes?: {
    booking_id?: string;
    property_id?: string;
    status?: string;
    arrival_date?: string;
    departure_date?: string;
    ota_name?: string | null;
    ota_reservation_code?: string | null;
    amount?: string | number | null;
    currency?: string | null;
    inserted_at?: string | null;
    customer?: {
      name?: string | null;
      surname?: string | null;
      mail?: string | null;
      phone?: string | null;
    } | null;
    occupancy?: Occupancy | null;
    rooms?: { occupancy?: Occupancy | null }[] | null;
  };
}

/** Channex's names for the channels, squashed to letters, mapped to V-01's. */
const CHANNELS: Record<string, BookingChannel> = {
  airbnb: 'airbnb',
  bookingcom: 'booking_com',
  booking: 'booking_com',
  vrbo: 'vrbo',
  homeaway: 'vrbo',
  expedia: 'expedia',
};

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Guests from the booking's own count, or added up across its rooms. */
function occupancy(a: NonNullable<RevisionResource['attributes']>): {
  adults: number;
  children: number;
  infants: number;
} {
  const rooms = a.rooms ?? [];
  const sum = (key: keyof Occupancy) =>
    a.occupancy ? count(a.occupancy[key]) : rooms.reduce((n, r) => n + count(r.occupancy?.[key]), 0);
  return { adults: Math.max(1, sum('adults')), children: sum('children'), infants: sum('infants') };
}

function text(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function toRevision(resource: RevisionResource): BookingRevision {
  const a = resource.attributes ?? {};
  const status = (['new', 'modified', 'cancelled'] as const).includes(a.status as RevisionStatus)
    ? (a.status as RevisionStatus)
    : 'modified';
  const guests = occupancy(a);
  const customer = a.customer ?? {};
  const name = [text(customer.name), text(customer.surname)].filter(Boolean).join(' ');
  return {
    id: resource.id,
    bookingId: a.booking_id ?? '',
    externalPropertyId: a.property_id ?? '',
    status,
    arrivalDate: a.arrival_date ?? '',
    departureDate: a.departure_date ?? '',
    otaName: a.ota_name ?? null,
    otaReservationCode: a.ota_reservation_code ?? null,
    channel: CHANNELS[(a.ota_name ?? '').toLowerCase().replace(/[^a-z]/g, '')] ?? 'direct',
    guestName: name || null,
    guestEmail: text(customer.mail),
    guestPhone: text(customer.phone),
    ...guests,
    amount: a.amount === undefined || a.amount === null ? null : String(a.amount),
    currency: a.currency ?? null,
    insertedAt: a.inserted_at ?? null,
    raw: resource,
  };
}

function toPushResult(envelope: ChannexEnvelope<unknown>): PushResult {
  const data = envelope.data;
  const first = Array.isArray(data) ? data[0] : data;
  const taskId =
    first && typeof first === 'object' && 'id' in first && typeof first.id === 'string' ? first.id : null;
  // Channex returns 200 with rejected items listed in meta.warnings, so a 200 is not the whole story.
  const warnings = (envelope.meta?.warnings ?? []).map((w) =>
    typeof w === 'string' ? w : JSON.stringify(w),
  );
  return { taskId, warnings };
}
