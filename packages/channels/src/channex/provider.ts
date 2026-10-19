import {
  type AvailabilityUpdate,
  type BookingChannel,
  type BookingRevision,
  ChannelError,
  type ChannelListingRef,
  type ChannelMapping,
  type ChannelProvider,
  type ChannelRef,
  type ChannelSetup,
  type ChannelState,
  type ExternalPropertyRef,
  type ListingSetup,
  type PushResult,
  type RestrictionUpdate,
  type RevisionStatus,
} from '../provider.ts';
import { ChannexClient, type ChannexConfig, type ChannexEnvelope } from './client.ts';

/** The id Channex gave something it just created. */
/**
 * Channex closes a night itself the moment a booking arrives, so it is never sold twice while V-01
 * is catching up, or down (recovery runbook). These are checked again after every connection and
 * daily, in case someone turned them off in Channex.
 */
const AUTO_CLOSE_SETTINGS = {
  allow_availability_autoupdate_on_confirmation: true,
  allow_availability_autoupdate_on_modification: true,
  allow_availability_autoupdate_on_cancellation: true,
} as const;
const AUTO_CLOSE_KEYS = Object.keys(AUTO_CLOSE_SETTINGS) as (keyof typeof AUTO_CLOSE_SETTINGS)[];

const CHANNEX_CHANNEL_NAMES: Record<ChannelSetup['channel'], string> = {
  airbnb: 'AirBNB',
  booking_com: 'BookingCom',
  vrbo: 'VRBO',
};

function attributesOf(response: unknown): Record<string, unknown> {
  const data = (response as { data?: { attributes?: unknown } } | null)?.data;
  const attributes = data?.attributes;
  return attributes && typeof attributes === 'object' ? (attributes as Record<string, unknown>) : {};
}

/** Channex names the authorisation link differently per channel; take whichever is there. */
function connectUrlIn(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  const settings = (record.settings && typeof record.settings === 'object' ? record.settings : {}) as Record<
    string,
    unknown
  >;
  for (const value of [
    record.connection_link,
    record.auth_url,
    record.url,
    settings.connection_link,
    settings.auth_url,
  ]) {
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  return null;
}

function settingsOf(response: unknown): Record<string, unknown> {
  const data = (response as { data?: { attributes?: { settings?: unknown } } } | null)?.data;
  const settings = data?.attributes?.settings;
  return settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
}

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
          ...AUTO_CLOSE_SETTINGS,
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

  async ensureAutoClose(externalPropertyId: string): Promise<{ wasOn: boolean }> {
    const id = encodeURIComponent(externalPropertyId);
    const current = await this.client.request('GET', `/properties/${id}`);
    const settings = settingsOf(current);
    const wasOn = AUTO_CLOSE_KEYS.every((key) => settings[key] === true);
    if (!wasOn) {
      await this.client.request('PUT', `/properties/${id}`, { property: { settings: AUTO_CLOSE_SETTINGS } });
    }
    return { wasOn };
  }

  /**
   * Channex's names for the channels, and what each needs. Airbnb and Vrbo hand back a link the
   * account's owner opens to authorise; Booking.com takes the hotel id and is approved on
   * Booking.com's side. The connection starts inactive; activation follows the first mapping.
   */
  async createChannel(setup: ChannelSetup): Promise<ChannelRef> {
    const channel = CHANNEX_CHANNEL_NAMES[setup.channel];
    const settings = setup.channel === 'booking_com' && setup.hotelId ? { hotel_id: setup.hotelId } : {};
    const created = await this.client.request('POST', '/channels', {
      channel: {
        channel,
        title: setup.title.slice(0, 255),
        group_id: setup.groupId,
        properties: setup.externalPropertyIds,
        settings,
      },
    });
    const channelId = createdId(created, 'channel');
    const attributes = attributesOf(created);
    const fromCreate = connectUrlIn(attributes);
    if (fromCreate || setup.channel === 'booking_com') return { channelId, connectUrl: fromCreate };
    // Airbnb and Vrbo: the authorisation link comes from the connection itself.
    const link = await this.client.request(
      'GET',
      `/channels/${encodeURIComponent(channelId)}/action/connection_link`,
    );
    return { channelId, connectUrl: connectUrlIn(attributesOf(link)) ?? connectUrlIn(link.data) };
  }

  async getChannelState(channelId: string): Promise<ChannelState> {
    const current = await this.client.request('GET', `/channels/${encodeURIComponent(channelId)}`);
    const attributes = attributesOf(current);
    const settings = (attributes.settings ?? {}) as Record<string, unknown>;
    const external = [settings.host_id, settings.hotel_id, settings.account_id].find(
      (v) => typeof v === 'string' && v,
    ) as string | undefined;
    return { active: attributes.is_active === true, externalAccountId: external ?? null };
  }

  async listChannelListings(channelId: string): Promise<ChannelListingRef[]> {
    const response = await this.client.request(
      'GET',
      `/channels/${encodeURIComponent(channelId)}/action/all_listings`,
    );
    const raw = Array.isArray(response.data) ? response.data : [];
    return raw.flatMap((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const attrs = (row.attributes && typeof row.attributes === 'object' ? row.attributes : row) as Record<
        string,
        unknown
      >;
      const id = [row.id, attrs.id, attrs.listing_id].find(
        (v) => typeof v === 'string' || typeof v === 'number',
      );
      if (id === undefined) return [];
      const title = [attrs.title, attrs.name].find((v) => typeof v === 'string') as string | undefined;
      const url = [attrs.url, attrs.listing_url].find((v) => typeof v === 'string') as string | undefined;
      return [{ externalListingId: String(id), title: title ?? null, url: url ?? null }];
    });
  }

  async setChannelMappings(channelId: string, mappings: ChannelMapping[]): Promise<void> {
    await this.client.request('PUT', `/channels/${encodeURIComponent(channelId)}`, {
      channel: {
        rate_plans: mappings.map((m) => ({
          rate_plan_id: m.ratePlanId,
          settings: { listing_id: m.externalListingId },
        })),
      },
    });
  }

  async activateChannel(channelId: string): Promise<void> {
    await this.client.request('POST', `/channels/${encodeURIComponent(channelId)}/activate`);
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
