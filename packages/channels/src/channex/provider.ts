import type {
  AvailabilityUpdate,
  BookingRevision,
  ChannelProvider,
  PushResult,
  RestrictionUpdate,
  RevisionStatus,
} from '../provider.ts';
import { ChannexClient, type ChannexConfig, type ChannexEnvelope } from './client.ts';

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
      if (u.maxStay !== undefined) value.max_stay = u.maxStay;
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
  };
}

function toRevision(resource: RevisionResource): BookingRevision {
  const a = resource.attributes ?? {};
  const status = (['new', 'modified', 'cancelled'] as const).includes(a.status as RevisionStatus)
    ? (a.status as RevisionStatus)
    : 'modified';
  return {
    id: resource.id,
    bookingId: a.booking_id ?? '',
    externalPropertyId: a.property_id ?? '',
    status,
    arrivalDate: a.arrival_date ?? '',
    departureDate: a.departure_date ?? '',
    otaName: a.ota_name ?? null,
    otaReservationCode: a.ota_reservation_code ?? null,
    amount: a.amount === undefined || a.amount === null ? null : String(a.amount),
    currency: a.currency ?? null,
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
