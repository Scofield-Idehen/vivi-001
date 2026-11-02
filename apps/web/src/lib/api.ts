import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountListingList,
  BankDetails,
  BookingSiteSettings,
  BookingSiteUpdate,
  BrandUpdate,
  Calendar,
  CalendarChange,
  CalendarChangeResult,
  CardRequestList,
  ChannelAccount,
  ChannelAccountConnect,
  ChannelAccountCreate,
  ChannelAccountList,
  ChannexState,
  ChargeCreate,
  Claim,
  ClaimFileKind,
  ClaimItemInput,
  ClaimList,
  ClaimUpdate,
  ClaimView,
  CleaningState,
  CleaningUpdate,
  ConnectAllResult,
  ConsoleOperatorDetail,
  ConsoleOperatorList,
  ConsoleOverview,
  ConsoleSync,
  Contract,
  ContractInput,
  CustomField,
  CustomFieldCreate,
  CustomFieldList,
  CustomFieldUpdate,
  DailyOverview,
  DamageReport,
  DoorCode,
  Expense,
  ExpenseInput,
  ExpenseList,
  ExpenseUpdate,
  GuestDepositLink,
  GuestLink,
  GuestStay,
  GuestyPeople,
  GuestyPeopleAdd,
  GuestyPeopleAdded,
  HomeTerms,
  HomeTermsInput,
  Insights,
  Invitation,
  InvitationList,
  Invite,
  InviteResult,
  LockConnect,
  LocksView,
  LockUpdate,
  Me,
  MemberHomes,
  MemberRoleUpdate,
  MemberSkills,
  MessageSend,
  MessageTemplate,
  MessageTemplateCreate,
  MessageTemplateList,
  MessageTemplateUpdate,
  MeUpdate,
  OverviewRange,
  Owner,
  OwnerInput,
  OwnerList,
  OwnerLoginBulk,
  OwnerLoginBulkResult,
  OwnerLoginInvite,
  OwnerMonth,
  OwnerSetup,
  OwnerUpdate,
  Payee,
  PayeeInput,
  PaymentCreate,
  PhotoStage,
  PhotoUploadTicket,
  Portal,
  PortalCalendar,
  PropertyCreate,
  PropertyDetail,
  PropertyField,
  PropertyFieldsUpdate,
  PropertyLinkCreate,
  PropertyLinkList,
  PropertyList,
  PropertyUpdate,
  Reservation,
  ReservationCancel,
  ReservationCreate,
  ReservationList,
  ReservationUpdate,
  ReservationView,
  Revenue,
  RoomInput,
  Site,
  SiteBooking,
  SiteBookLink,
  SiteBookRequest,
  SiteHome,
  SiteNights,
  SiteQuote,
  SiteQuoteRequest,
  StatementList,
  SupportAccessStart,
  SupportGrant,
  SupportGrantList,
  SupportVisitList,
  Task,
  TaskCreate,
  TaskList,
  TaskListQuery,
  TaskTemplate,
  TaskTemplateUpdate,
  TaskUpdate,
  TeamList,
  TeamMember,
  Thread,
  ThreadDetail,
  ThreadList,
  ThreadListQuery,
  ThreadUpdate,
  Today,
  Trends,
  Workspace,
  WorkspaceSync,
} from '@v01/shared';
import { config } from './config.ts';
import {
  demoAddClaimFile,
  demoAddPhoto,
  demoAddTaskPhoto,
  demoFetch,
  demoSetContractFile,
  demoSetReceipt,
} from './demo.ts';
import { ApiError } from './errors.ts';
import {
  ACCEPTED,
  PhotoError,
  type PhotoStamp,
  type PreparedPhoto,
  preparePhoto,
  stampPhoto,
  stampText,
  stampWhen,
  takenAt,
} from './images.ts';
import { refreshedToken, signOut, useSession } from './session.tsx';

export { ApiError };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function apiFetch<T>(
  path: string,
  options: { token: string | null; orgId?: string | null; method?: Method; body?: unknown },
  retried = false,
): Promise<T> {
  if (config.demo) return demoFetch<T>(path, options);
  // The guest's stay page is the one call made without signing in.
  const headers: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {};
  if (options.orgId) headers['x-org-id'] = options.orgId;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = (await response.json().catch(() => null)) as {
    error?: { code: string; message: string };
  } | null;
  if (!response.ok) {
    const code = data?.error?.code ?? 'error';
    if (response.status === 401 && options.token) {
      // The token in hand is stale (the laptop slept, say): get a fresh one and try once more.
      if (code === 'invalid_token' && !retried) {
        const fresh = await refreshedToken();
        if (fresh) return apiFetch<T>(path, { ...options, token: fresh }, true);
      }
      // The sign-in itself has run out, or can't be refreshed: back to the sign-in page, cleanly.
      if (code === 'invalid_token' || code === 'session_expired') void signOut();
    }
    throw new ApiError(
      response.status,
      code,
      data?.error?.message ?? `The request failed (${response.status}).`,
    );
  }
  return data as T;
}

function useToken(): string | null {
  return useSession().session?.access_token ?? null;
}

export function useMe() {
  const token = useToken();
  return useQuery({
    queryKey: ['me', token ? 'signed-in' : 'signed-out'],
    enabled: Boolean(token),
    queryFn: () => apiFetch<Me>('/v1/me', { token: token as string }),
  });
}

export function useWorkspace(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['workspace', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<Workspace>('/v1/workspace', { token: token as string, orgId }),
  });
}

export function useProperties(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['properties', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<PropertyList>('/v1/properties', { token: token as string, orgId }),
    // While the worker is connecting properties to Channex, the list watches them turn green.
    refetchInterval: (query) =>
      query.state.data?.properties.some((p) => p.channexStatus === 'connecting') ? 4000 : false,
  });
}

/** Connect all: every property not yet in Channex, queued for the worker in one go. */
export function useConnectAllChannex(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ConnectAllResult>('/v1/channex/connect-all', {
        token: token as string,
        orgId,
        method: 'POST',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['properties', orgId] });
    },
  });
}

/** V-01 support visits to this workspace: who opened it, why, and for how long. */
export function useSupportVisits(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['support-visits', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () =>
      apiFetch<SupportVisitList>('/v1/workspace/support-visits', { token: token as string, orgId }),
  });
}

export function useAddProperty(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PropertyCreate) =>
      apiFetch<PropertyDetail>('/v1/properties', {
        token: token as string,
        orgId,
        method: 'POST',
        body: input,
      }),
    // The console counts properties too, so V-01 staff see the new one at once.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['properties', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['console'] }),
      ]),
  });
}

// One property's whole listing -------------------------------------------------------------------

export function useProperty(orgId: string | null, id: string) {
  const token = useToken();
  return useQuery({
    queryKey: ['property', orgId, id],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<PropertyDetail>(`/v1/properties/${id}`, { token: token as string, orgId }),
  });
}

/** Every change answers with the whole listing, which replaces the cached one. */
function usePropertyChange<Input>(
  orgId: string | null,
  id: string,
  send: (token: string, input: Input) => Promise<PropertyDetail>,
) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => send(token as string, input),
    onSuccess: async (detail) => {
      queryClient.setQueryData(['property', orgId, id], detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['properties', orgId] }),
        // Names, usual prices, stays and tags all show on the Calendar.
        queryClient.invalidateQueries({ queryKey: ['calendar', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['console'] }),
      ]);
    },
  });
}

export const useUpdateProperty = (orgId: string | null, id: string) =>
  usePropertyChange<PropertyUpdate>(orgId, id, (token, body) =>
    apiFetch(`/v1/properties/${id}`, { token, orgId, method: 'PATCH', body }),
  );

export const useSetRooms = (orgId: string | null, id: string) =>
  usePropertyChange<RoomInput[]>(orgId, id, (token, rooms) =>
    apiFetch(`/v1/properties/${id}/rooms`, { token, orgId, method: 'PUT', body: { rooms } }),
  );

export const useSetAmenities = (orgId: string | null, id: string) =>
  usePropertyChange<string[]>(orgId, id, (token, amenities) =>
    apiFetch(`/v1/properties/${id}/amenities`, { token, orgId, method: 'PUT', body: { amenities } }),
  );

export const useOrderPhotos = (orgId: string | null, id: string) =>
  usePropertyChange<string[]>(orgId, id, (token, photoIds) =>
    apiFetch(`/v1/properties/${id}/photos/order`, { token, orgId, method: 'PUT', body: { photoIds } }),
  );

export const useUpdatePhoto = (orgId: string | null, id: string) =>
  usePropertyChange<{ photoId: string; caption?: string | null; roomId?: string | null }>(
    orgId,
    id,
    (token, { photoId, ...body }) =>
      apiFetch(`/v1/properties/${id}/photos/${photoId}`, { token, orgId, method: 'PATCH', body }),
  );

export const useRemovePhoto = (orgId: string | null, id: string) =>
  usePropertyChange<string>(orgId, id, (token, photoId) =>
    apiFetch(`/v1/properties/${id}/photos/${photoId}`, { token, orgId, method: 'DELETE' }),
  );

/** One photo: a ticket from the API, the file straight to storage, then the photo registered. */
export async function uploadPhoto(
  token: string,
  orgId: string | null,
  propertyId: string,
  photo: PreparedPhoto,
): Promise<PropertyDetail> {
  if (config.demo) return demoAddPhoto(orgId, propertyId, photo);
  const ticket = await apiFetch<PhotoUploadTicket>(`/v1/properties/${propertyId}/photos/uploads`, {
    token,
    orgId,
    method: 'POST',
    body: { contentType: photo.contentType, bytes: photo.blob.size },
  });
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, {
      method: ticket.method,
      headers: ticket.headers,
      body: photo.blob,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach photo storage. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new ApiError(response.status, 'upload_failed', 'A photo could not be uploaded. Try again.');
  }
  return apiFetch<PropertyDetail>(`/v1/properties/${propertyId}/photos`, {
    token,
    orgId,
    method: 'POST',
    body: { path: ticket.path, width: photo.width, height: photo.height },
  });
}

/**
 * Prepares and uploads photos one at a time, showing each as it lands. A photo that fails
 * doesn't stop the rest; its reason comes back in `problems`.
 */
export async function uploadPhotos(
  token: string,
  orgId: string | null,
  propertyId: string,
  files: File[],
  onEach?: (detail: PropertyDetail | null, done: number) => void,
): Promise<{ detail: PropertyDetail | null; problems: string[] }> {
  let detail: PropertyDetail | null = null;
  const problems: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const prepared = await preparePhoto(file, config.demo ? 1600 : 2560);
      detail = await uploadPhoto(token, orgId, propertyId, prepared);
    } catch (error) {
      problems.push(
        error instanceof PhotoError || error instanceof ApiError
          ? error.message
          : `${file.name} could not be added.`,
      );
    }
    onEach?.(detail, index + 1);
  }
  return { detail, problems };
}

export function useAddPhotos(orgId: string | null, id: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      files,
      onProgress,
    }: {
      files: File[];
      onProgress?: (done: number, total: number) => void;
    }) =>
      uploadPhotos(token as string, orgId, id, files, (detail, done) => {
        if (detail) queryClient.setQueryData(['property', orgId, id], detail);
        onProgress?.(done, files.length);
      }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['properties', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['console'] }),
      ]),
  });
}

// The calendar ----------------------------------------------------------------------------------

/** Only properties free for a stay: the calendar's Availability filter. */
export interface FreeFor {
  from: string;
  to: string;
  guests: number;
}

function calendarQuery(from: string, to: string, free?: FreeFor | null): URLSearchParams {
  const query = new URLSearchParams({ from, to });
  if (free) {
    query.set('freeFrom', free.from);
    query.set('freeTo', free.to);
    query.set('guests', String(free.guests));
  }
  return query;
}

/**
 * The calendar in pieces of a few weeks, fetched as they scroll into view and kept once fetched.
 * While a piece's filter changes, its last answer stays on screen until the new one arrives.
 */
export function useCalendarPieces(
  orgId: string | null,
  pieces: { from: string; to: string }[],
  free?: FreeFor | null,
) {
  const token = useToken();
  return useQueries({
    queries: pieces.map((piece) => {
      const query = calendarQuery(piece.from, piece.to, free);
      return {
        queryKey: ['calendar', orgId, query.toString()],
        enabled: Boolean(token && orgId),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        queryFn: () => apiFetch<Calendar>(`/v1/calendar?${query}`, { token: token as string, orgId }),
      };
    }),
  });
}

/** Marks a property clean or dirty. The calendar shows the change at once. */
export function useSetCleaning(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, status }: { propertyId: string } & CleaningUpdate) =>
      apiFetch<CleaningState>(`/v1/properties/${propertyId}/cleaning`, {
        token: token as string,
        orgId,
        method: 'PUT',
        body: { status },
      }),
    onSuccess: (_state, { propertyId }) => {
      void queryClient.invalidateQueries({ queryKey: ['calendar', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['property', orgId, propertyId] });
    },
  });
}

/** Archives a property: it leaves every screen. */
export function useArchiveProperty(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (propertyId: string) =>
      apiFetch<{ archivedAt: string }>(`/v1/properties/${propertyId}/archive`, {
        token: token as string,
        orgId,
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['properties', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['calendar', orgId] });
    },
  });
}

/** Asks for a property to be connected to Channex. The worker does it; the page polls until it has. */
export function useConnectChannex(orgId: string | null, propertyId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ChannexState>(`/v1/properties/${propertyId}/channex`, {
        token: token as string,
        orgId,
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['property', orgId, propertyId] }),
  });
}

export function useChangeCalendar(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: CalendarChange) =>
      apiFetch<CalendarChangeResult>('/v1/calendar', {
        token: token as string,
        orgId,
        method: 'PATCH',
        body: change,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar', orgId] }),
  });
}

// Bookings --------------------------------------------------------------------------------------

/** The Reservations list: upcoming (staying now included), past or cancelled, optionally searched. */
export function useReservations(orgId: string | null, view: ReservationView, search: string) {
  const token = useToken();
  const query = new URLSearchParams({ view });
  if (search.trim()) query.set('q', search.trim());
  return useQuery({
    queryKey: ['reservations', orgId, query.toString()],
    enabled: Boolean(token && orgId),
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<ReservationList>(`/v1/reservations?${query}`, { token: token as string, orgId }),
  });
}

/** One booking, with everything the reservation page shows. */
export function useReservation(orgId: string | null, id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['reservation', orgId, id],
    enabled: Boolean(token && orgId && id),
    queryFn: () => apiFetch<Reservation>(`/v1/reservations/${id}`, { token: token as string, orgId }),
  });
}

/** Contact details, agreed times and notes. The calendar and lists show the new guest name too. */
/** A booking made by the team: a direct or repeat guest. */
export function useCreateReservation(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReservationCreate) =>
      apiFetch<Reservation>('/v1/reservations', { token: token as string, orgId, method: 'POST', body }),
    onSuccess: async (reservation) => {
      queryClient.setQueryData(['reservation', orgId, reservation.id], reservation);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservations', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['calendar', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['today', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
      ]);
    },
  });
}

export function useUpdateReservation(orgId: string | null, id: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: ReservationUpdate) =>
      apiFetch<Reservation>(`/v1/reservations/${id}`, {
        token: token as string,
        orgId,
        method: 'PATCH',
        body: change,
      }),
    onSuccess: async (reservation) => {
      queryClient.setQueryData(['reservation', orgId, id], reservation);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservations', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['calendar', orgId] }),
      ]);
    },
  });
}

/** Charges, payments and cancelling: each answers with the whole booking, which replaces the one on screen. */
function useReservationAction<B>(orgId: string | null, id: string, path: (b: B) => string, method: Method) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: B) =>
      apiFetch<Reservation>(`/v1/reservations/${id}${path(body)}`, {
        token: token as string,
        orgId,
        method,
        ...(method === 'DELETE' ? {} : { body }),
      }),
    onSuccess: async (reservation) => {
      queryClient.setQueryData(['reservation', orgId, id], reservation);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reservations', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['calendar', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['today', orgId] }),
      ]);
    },
  });
}

export const useAddCharge = (orgId: string | null, id: string) =>
  useReservationAction<ChargeCreate>(orgId, id, () => '/charges', 'POST');
export const useRemoveCharge = (orgId: string | null, id: string) =>
  useReservationAction<string>(orgId, id, (chargeId) => `/charges/${chargeId}`, 'DELETE');
export const useAddPayment = (orgId: string | null, id: string) =>
  useReservationAction<PaymentCreate>(orgId, id, () => '/payments', 'POST');
export const useRemovePayment = (orgId: string | null, id: string) =>
  useReservationAction<string>(orgId, id, (paymentId) => `/payments/${paymentId}`, 'DELETE');
export const useCancelReservation = (orgId: string | null, id: string) =>
  useReservationAction<ReservationCancel>(orgId, id, () => '/cancel', 'POST');

// Card payments and deposits (Stripe) ---------------------------------------------------------

export function useCardRequests(orgId: string | null, id: string) {
  const token = useToken();
  return useQuery({
    queryKey: ['card-requests', orgId, id],
    enabled: Boolean(token && orgId),
    queryFn: () =>
      apiFetch<CardRequestList>(`/v1/reservations/${id}/card-requests`, { token: token as string, orgId }),
    // An open link or a held deposit can change at Stripe: look again now and then while it's on screen.
    refetchInterval: (q) =>
      q.state.data?.requests.some((r) => r.status === 'open' || r.status === 'held') ? 20_000 : false,
  });
}

/** Any card action: the list comes back, and the booking (its payments) is read again. */
export function useCardAction<B = void>(
  orgId: string | null,
  reservationId: string,
  path: (b: B) => string,
  body?: (b: B) => unknown,
) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (b: B) =>
      apiFetch<CardRequestList>(path(b), {
        token: token as string,
        orgId,
        method: 'POST',
        ...(body ? { body: body(b) } : {}),
      }),
    onSuccess: async (list) => {
      queryClient.setQueryData(['card-requests', orgId, reservationId], list);
      await queryClient.invalidateQueries({ queryKey: ['reservation', orgId, reservationId] });
    },
  });
}

/** The token for work that runs outside a hook, like uploading photos after adding a property. */
export function useApiToken(): string | null {
  return useToken();
}

// The V-01 console ----------------------------------------------------------------------------
// Console screens refresh every half minute, so sync problems show up without reloading.
const CONSOLE_REFRESH = 30_000;

function useConsoleQuery<T>(key: string[], path: string, refetchInterval: number | false = CONSOLE_REFRESH) {
  const token = useToken();
  return useQuery({
    queryKey: ['console', ...key],
    enabled: Boolean(token),
    refetchInterval,
    queryFn: () => apiFetch<T>(path, { token: token as string }),
  });
}

export const useConsoleOverview = () =>
  useConsoleQuery<ConsoleOverview>(['overview'], '/v1/console/overview');
export const useConsoleOperators = () =>
  useConsoleQuery<ConsoleOperatorList>(['operators'], '/v1/console/operators');
export const useConsoleOperator = (id: string) =>
  useConsoleQuery<ConsoleOperatorDetail>(['operators', id], `/v1/console/operators/${id}`, false);
export const useConsoleSync = () => useConsoleQuery<ConsoleSync>(['sync'], '/v1/console/sync');
export const useSupportLog = () => useConsoleQuery<SupportGrantList>(['support'], '/v1/console/support');

/** Opens read-only support access to one operator, then waits until the workspace list knows about it. */
export function useStartSupportAccess(orgId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SupportAccessStart) =>
      apiFetch<SupportGrant>(`/v1/console/operators/${orgId}/support-access`, {
        token: token as string,
        method: 'POST',
        body: input,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['console'] }),
      ]);
    },
  });
}

export function useEndSupportAccess() {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      apiFetch<{ ended: boolean }>(`/v1/console/support-access/${grantId}/end`, {
        token: token as string,
        method: 'POST',
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['console'] }),
      ]);
    },
  });
}

/** The workspace's custom fields, as an admin manages them. */
export function useCustomFields(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['custom-fields', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<CustomFieldList>('/v1/custom-fields', { token: token as string, orgId }),
  });
}

/** Defining, renaming, moving or removing a field changes every property's page. */
function useFieldChange<Input>(
  orgId: string | null,
  send: (token: string, input: Input) => Promise<unknown>,
) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => send(token as string, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['custom-fields', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['property', orgId] }),
      ]);
    },
  });
}

export const useCreateField = (orgId: string | null) =>
  useFieldChange<CustomFieldCreate>(orgId, (token, body) =>
    apiFetch<CustomField>('/v1/custom-fields', { token, orgId, method: 'POST', body }),
  );

export const useUpdateField = (orgId: string | null) =>
  useFieldChange<{ id: string } & CustomFieldUpdate>(orgId, (token, { id, ...body }) =>
    apiFetch<CustomField>(`/v1/custom-fields/${id}`, { token, orgId, method: 'PATCH', body }),
  );

export const useDeleteField = (orgId: string | null) =>
  useFieldChange<string>(orgId, (token, id) =>
    apiFetch<{ deleted: true }>(`/v1/custom-fields/${id}`, { token, orgId, method: 'DELETE' }),
  );

/** Values on one property. The answer is the property's fields, which replace the cached ones. */
export function useSetFields(orgId: string | null, id: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: PropertyFieldsUpdate['values']) =>
      apiFetch<{ fields: PropertyField[] }>(`/v1/properties/${id}/fields`, {
        token: token as string,
        orgId,
        method: 'PUT',
        body: { values },
      }),
    onSuccess: ({ fields }) => {
      queryClient.setQueryData<PropertyDetail>(['property', orgId, id], (current) =>
        current ? { ...current, fields } : current,
      );
    },
  });
}

/** The workspace's channel accounts, with their Channex connections. Polled while any is pending. */
export function useChannelAccounts(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['channel-accounts', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<ChannelAccountList>('/v1/channel-accounts', { token: token as string, orgId }),
    refetchInterval: (query) =>
      query.state.data?.accounts.some((a) => a.status === 'pending') ? 5000 : false,
  });
}

function useAccountChange<Input>(
  orgId: string | null,
  send: (token: string, input: Input) => Promise<unknown>,
) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => send(token as string, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['channel-accounts', orgId] });
    },
  });
}

export const useAddChannelAccount = (orgId: string | null) =>
  useAccountChange<ChannelAccountCreate>(orgId, (token, body) =>
    apiFetch<ChannelAccount>('/v1/channel-accounts', { token, orgId, method: 'POST', body }),
  );

export const useConnectChannelAccount = (orgId: string | null) =>
  useAccountChange<{ id: string } & ChannelAccountConnect>(orgId, (token, { id, ...body }) =>
    apiFetch<ChannelAccount>(`/v1/channel-accounts/${id}/connect`, { token, orgId, method: 'POST', body }),
  );

/** The listings Channex sees on one account, and which property each is linked to. */
export function useAccountListings(orgId: string | null, accountId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['account-listings', orgId, accountId],
    enabled: Boolean(token && orgId && accountId),
    queryFn: () =>
      apiFetch<AccountListingList>(`/v1/channel-accounts/${accountId}/listings`, {
        token: token as string,
        orgId,
      }),
  });
}

/** Linking and unlinking answer with the property's links, which replace the cached ones. */
function useLinkChange<Input>(
  orgId: string | null,
  propertyId: string,
  send: (token: string, input: Input) => Promise<PropertyLinkList>,
) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => send(token as string, input),
    onSuccess: async ({ links }) => {
      queryClient.setQueryData<PropertyDetail>(['property', orgId, propertyId], (current) =>
        current ? { ...current, links } : current,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['channel-accounts', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['account-listings', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['properties', orgId] }),
      ]);
    },
  });
}

export const useLinkListing = (orgId: string | null, propertyId: string) =>
  useLinkChange<PropertyLinkCreate>(orgId, propertyId, (token, body) =>
    apiFetch(`/v1/properties/${propertyId}/links`, { token, orgId, method: 'POST', body }),
  );

/** Airbnb only: pause takes the listing off Airbnb through Channex; resume puts it back. */
export const usePauseListing = (orgId: string | null, propertyId: string) =>
  useLinkChange<{ linkId: string; action: 'pause' | 'resume' }>(
    orgId,
    propertyId,
    (token, { linkId, action }) =>
      apiFetch(`/v1/properties/${propertyId}/links/${linkId}/${action}`, { token, orgId, method: 'POST' }),
  );

export const useUnlinkListing = (orgId: string | null, propertyId: string) =>
  useLinkChange<string>(orgId, propertyId, (token, linkId) =>
    apiFetch(`/v1/properties/${propertyId}/links/${linkId}`, { token, orgId, method: 'DELETE' }),
  );

/** The workspace's own sync picture, refreshed every 30 seconds while the page is open. */
/** The Today page: arrivals, departures, cleans due and what needs a person. Looks again every minute. */
export function useToday(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['today', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<Today>('/v1/today', { token: token as string, orgId }),
    refetchInterval: 60_000,
  });
}

/** The booking's private link for the guest; for roles that may change the booking. */
export function useGuestLink(orgId: string | null, reservationId: string | null, enabled: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: ['guest-link', orgId, reservationId],
    enabled: Boolean(token && orgId && reservationId && enabled),
    queryFn: () =>
      apiFetch<GuestLink>(`/v1/reservations/${reservationId}/guest-link`, { token: token as string, orgId }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The guest's page for their stay: public, by the key in their link. */
export function useGuestStay(key: string | null) {
  return useQuery({
    queryKey: ['stay', key],
    enabled: Boolean(key),
    queryFn: () => apiFetch<GuestStay>(`/v1/stay/${key}`, { token: null }),
    retry: false,
    refetchInterval: 5 * 60_000,
  });
}

// The booking website: public, no sign-in --------------------------------------------------------

const searchQuery = (q: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
  const text = params.toString();
  return text ? `?${text}` : '';
};

export type SiteSearchParams = {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  infants?: number;
  pets?: number;
};

/** A preview is the team's look at their own site: signed in, in that workspace (`orgId`). */
function usePreview(preview: string | null) {
  const token = useToken();
  return {
    auth: preview ? { token, orgId: preview } : { token: null },
    flag: preview ? { preview: '1' } : {},
    ready: !preview || Boolean(token),
  };
}

export function useSite(slug: string, search: SiteSearchParams, preview: string | null = null) {
  const p = usePreview(preview);
  return useQuery({
    queryKey: ['site', slug, search, preview],
    enabled: p.ready,
    queryFn: () => apiFetch<Site>(`/v1/site/${slug}${searchQuery({ ...search, ...p.flag })}`, p.auth),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSiteHome(slug: string, homeId: string, preview: string | null = null) {
  const p = usePreview(preview);
  return useQuery({
    queryKey: ['site-home', slug, homeId, preview],
    enabled: p.ready,
    queryFn: () => apiFetch<SiteHome>(`/v1/site/${slug}/homes/${homeId}${searchQuery(p.flag)}`, p.auth),
    retry: false,
  });
}

export function useSiteNights(
  slug: string,
  homeId: string,
  from: string,
  to: string,
  preview: string | null = null,
) {
  const p = usePreview(preview);
  return useQuery({
    queryKey: ['site-nights', slug, homeId, from, to, preview],
    enabled: p.ready,
    queryFn: () =>
      apiFetch<SiteNights>(
        `/v1/site/${slug}/homes/${homeId}/nights${searchQuery({ from, to, ...p.flag })}`,
        p.auth,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useSiteQuote(slug: string, request: SiteQuoteRequest | null, preview: string | null = null) {
  const p = usePreview(preview);
  return useQuery({
    queryKey: ['site-quote', slug, request, preview],
    enabled: Boolean(request) && p.ready,
    queryFn: () =>
      apiFetch<SiteQuote>(`/v1/site/${slug}/quote${searchQuery(p.flag)}`, {
        ...p.auth,
        method: 'POST',
        body: request,
      }),
  });
}

/** Book: V-01 checks the price again and sends the guest to Stripe's page to pay. */
export function useSiteBook(slug: string, go: (path: string) => void) {
  return useMutation({
    mutationFn: (body: SiteBookRequest) =>
      apiFetch<SiteBookLink>(`/v1/site/${slug}/book`, { token: null, method: 'POST', body }),
    onSuccess: ({ url }) => {
      // Stripe's page; in the demo, which has no Stripe, the page it would send the guest back to.
      if (url.startsWith('/')) go(url);
      else window.location.assign(url);
    },
  });
}

export function useSiteBooking(slug: string, bookingId: string) {
  return useQuery({
    queryKey: ['site-booking', slug, bookingId],
    queryFn: () => apiFetch<SiteBooking>(`/v1/site/${slug}/bookings/${bookingId}`, { token: null }),
    retry: false,
    // While the guest is between Stripe and here, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.status === 'open' ? 3000 : false),
  });
}

/** The team's settings for the booking website. */
export function useBookingSite(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['booking-site', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () =>
      apiFetch<BookingSiteSettings>('/v1/workspace/booking-site', { token: token as string, orgId }),
  });
}

export function useUpdateBookingSite(orgId: string | null) {
  const token = useToken();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BookingSiteUpdate) =>
      apiFetch<BookingSiteSettings>('/v1/workspace/booking-site', {
        token: token as string,
        orgId,
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => client.setQueryData(['booking-site', orgId], data),
  });
}

/** The guest goes to Stripe to add their card for the deposit. */
export function useGuestDeposit(key: string) {
  return useMutation({
    mutationFn: () => apiFetch<GuestDepositLink>(`/v1/stay/${key}/deposit`, { token: null, method: 'POST' }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
}

export function useWorkspaceSync(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['workspace-sync', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<WorkspaceSync>('/v1/channels/sync', { token: token as string, orgId }),
    refetchInterval: 30_000,
  });
}

// Tasks: cleans, maintenance and inspections for the field team.

export function useTasks(orgId: string | null, query: TaskListQuery) {
  const token = useToken();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, String(v));
  return useQuery({
    queryKey: ['tasks', orgId, params.toString()],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<TaskList>(`/v1/tasks?${params}`, { token: token as string, orgId }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useTask(orgId: string | null, taskId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['task', orgId, taskId],
    enabled: Boolean(token && orgId && taskId),
    queryFn: () => apiFetch<Task>(`/v1/tasks/${taskId}`, { token: token as string, orgId }),
  });
}

export function useCreateTask(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskCreate) =>
      apiFetch<Task>('/v1/tasks', { token: token as string, orgId, method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
    },
  });
}

export function useUpdateTask(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...body }: { taskId: string } & TaskUpdate) =>
      apiFetch<Task>(`/v1/tasks/${taskId}`, { token: token as string, orgId, method: 'PATCH', body }),
    onSuccess: (task) => {
      queryClient.setQueryData(['task', orgId, task.id], task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['calendar', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['property', orgId, task.propertyId] });
    },
  });
}

/** One photo onto a task: the ticket, the upload, the register. */
export interface TaskPhotoUpload {
  files: File[];
  stage: PhotoStage;
  /** The words to burn into each picture; the same words are kept with the photo. */
  stamp: PhotoStamp;
}

async function uploadTaskPhoto(
  token: string,
  orgId: string | null,
  taskId: string,
  file: File,
  stage: PhotoStage,
  stamp: PhotoStamp,
): Promise<Task> {
  // The camera's own time, not the upload's: an old photo from the gallery says when it was taken.
  const own: PhotoStamp = { ...stamp, when: stampWhen(await takenAt(file), new Date()) };
  stamp = own;
  const photo = await stampPhoto(await preparePhoto(file, config.demo ? 1600 : 2048), stamp);
  if (config.demo) return demoAddTaskPhoto(orgId, taskId, photo, stage, stampText(stamp));
  const ticket = await apiFetch<PhotoUploadTicket>(`/v1/tasks/${taskId}/photos/uploads`, {
    token,
    orgId,
    method: 'POST',
    body: { contentType: photo.contentType, bytes: photo.blob.size },
  });
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, {
      method: ticket.method,
      headers: ticket.headers,
      body: photo.blob,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach photo storage. Check your connection and try again.');
  }
  if (!response.ok)
    throw new ApiError(response.status, 'upload_failed', 'The photo could not be uploaded. Try again.');
  return apiFetch<Task>(`/v1/tasks/${taskId}/photos`, {
    token,
    orgId,
    method: 'POST',
    body: { path: ticket.path, width: photo.width, height: photo.height, stage, stamp: stampText(stamp) },
  });
}

export function useAddTaskPhotos(orgId: string | null, taskId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, stage, stamp }: TaskPhotoUpload) => {
      const problems: string[] = [];
      let task: Task | null = null;
      for (const file of files) {
        try {
          task = await uploadTaskPhoto(token as string, orgId, taskId, file, stage, stamp);
          queryClient.setQueryData(['task', orgId, taskId], task);
        } catch (error) {
          problems.push(
            error instanceof PhotoError || error instanceof ApiError
              ? error.message
              : `${file.name} could not be added.`,
          );
        }
      }
      return { task, problems };
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
  });
}

export function useRemoveTaskPhoto(orgId: string | null, taskId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<Task>(`/v1/tasks/${taskId}/photos/${photoId}`, {
        token: token as string,
        orgId,
        method: 'DELETE',
      }),
    onSuccess: (task) => {
      queryClient.setQueryData(['task', orgId, taskId], task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
    },
  });
}

/** The crew reporting damage from a job: a maintenance task for the office. */
export function useReportDamage(orgId: string | null, taskId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DamageReport) =>
      apiFetch<Task>(`/v1/tasks/${taskId}/report`, { token: token as string, orgId, method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
    },
  });
}

export function useTaskTemplates(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['task-templates', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () =>
      apiFetch<{ templates: TaskTemplate[] }>('/v1/task-templates', { token: token as string, orgId }),
  });
}

export function useUpdateTaskTemplate(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, ...body }: { kind: TaskTemplate['kind'] } & TaskTemplateUpdate) =>
      apiFetch<TaskTemplate>(`/v1/task-templates/${kind}`, {
        token: token as string,
        orgId,
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['task-templates', orgId] }),
  });
}

/** The workspace's people, for assigning tasks and naming a property's usual cleaner. */
export function useTeam(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['team', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<TeamList>('/v1/team', { token: token as string, orgId }),
    staleTime: 5 * 60_000,
  });
}

// The Inbox: one thread per booking; replies queue for the worker.

export function useThreads(orgId: string | null, query: ThreadListQuery) {
  const token = useToken();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, String(v));
  return useQuery({
    queryKey: ['threads', orgId, params.toString()],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<ThreadList>(`/v1/inbox/threads?${params}`, { token: token as string, orgId }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useThread(orgId: string | null, threadId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['thread', orgId, threadId],
    enabled: Boolean(token && orgId && threadId),
    queryFn: () => apiFetch<ThreadDetail>(`/v1/inbox/threads/${threadId}`, { token: token as string, orgId }),
    refetchInterval: 20_000,
  });
}

/** A booking's thread, for the link on its page. */
export function useReservationThread(orgId: string | null, reservationId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['reservation-thread', orgId, reservationId],
    enabled: Boolean(token && orgId && reservationId),
    queryFn: () =>
      apiFetch<Thread>(`/v1/reservations/${reservationId}/thread`, { token: token as string, orgId }),
  });
}

export function useSendMessage(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...body }: { threadId: string } & MessageSend) =>
      apiFetch<ThreadDetail>(`/v1/inbox/threads/${threadId}/messages`, {
        token: token as string,
        orgId,
        method: 'POST',
        body,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(['thread', orgId, detail.thread.id], detail);
      void queryClient.invalidateQueries({ queryKey: ['threads', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
    },
  });
}

export function useUpdateThread(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...body }: { threadId: string } & ThreadUpdate) =>
      apiFetch<Thread>(`/v1/inbox/threads/${threadId}`, {
        token: token as string,
        orgId,
        method: 'PATCH',
        body,
      }),
    onSuccess: (thread) => {
      queryClient.setQueryData(['thread', orgId, thread.id], (old: ThreadDetail | undefined) =>
        old ? { ...old, thread } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['threads', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
    },
  });
}

export function useMessageTemplates(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['message-templates', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<MessageTemplateList>('/v1/inbox/templates', { token: token as string, orgId }),
  });
}

export function useCreateMessageTemplate(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MessageTemplateCreate) =>
      apiFetch<MessageTemplate>('/v1/inbox/templates', {
        token: token as string,
        orgId,
        method: 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['message-templates', orgId] }),
  });
}

export function useUpdateMessageTemplate(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & MessageTemplateUpdate) =>
      apiFetch<MessageTemplate>(`/v1/inbox/templates/${id}`, {
        token: token as string,
        orgId,
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['message-templates', orgId] }),
  });
}

export function useDeleteMessageTemplate(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/v1/inbox/templates/${id}`, { token: token as string, orgId, method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['message-templates', orgId] }),
  });
}

// The team: invitations and roles (admins).

export function useInvitations(orgId: string | null, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['invitations', orgId],
    enabled: Boolean(token && orgId && enabled),
    queryFn: () => apiFetch<InvitationList>('/v1/invitations', { token: token as string, orgId }),
  });
}

export function useInvite(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Invite) =>
      apiFetch<InviteResult>('/v1/invitations', { token: token as string, orgId, method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invitations', orgId] }),
  });
}

export function useCancelInvitation(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Invitation['id']) =>
      apiFetch<null>(`/v1/invitations/${id}`, { token: token as string, orgId, method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invitations', orgId] }),
  });
}

export function useChangeRole(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string } & MemberRoleUpdate) =>
      apiFetch<TeamMember>(`/v1/members/${userId}`, { token: token as string, orgId, method: 'PATCH', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team', orgId] }),
  });
}

export function useRemoveMember(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<null>(`/v1/members/${userId}`, { token: token as string, orgId, method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team', orgId] }),
  });
}

/** The number guests call, on the Workspace page (admins). */
export function useUpdateBrand(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BrandUpdate) =>
      apiFetch<Workspace>('/v1/workspace/brand', { token: token as string, orgId, method: 'PATCH', body }),
    onSuccess: (workspace) => {
      queryClient.setQueryData(['workspace', orgId], workspace);
    },
  });
}

/** A person's own name, as the team sees it. */
export function useUpdateMe() {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MeUpdate) =>
      apiFetch<{ fullName: string }>('/v1/me', { token: token as string, method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });
}

// Door locks (TTLock): connect the account, put locks on homes, turn codes on.

export function useLocks(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['locks', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<LocksView>('/v1/locks', { token: token as string, orgId }),
    staleTime: 60_000,
  });
}

function useLockMutation<B>(
  orgId: string | null,
  call: (body: B) => { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: B) => {
      const c = call(body);
      return apiFetch<LocksView>(c.path, { token: token as string, orgId, method: c.method, body: c.body });
    },
    onSuccess: (view) => {
      queryClient.setQueryData(['locks', orgId], view);
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
    },
  });
}

export const useConnectLocks = (orgId: string | null) =>
  useLockMutation<LockConnect>(orgId, (body) => ({ path: '/v1/locks/connect', method: 'POST', body }));
export const useRefreshLocks = (orgId: string | null) =>
  useLockMutation<void>(orgId, () => ({ path: '/v1/locks/refresh', method: 'POST' }));
export const useDisconnectLocks = (orgId: string | null) =>
  useLockMutation<void>(orgId, () => ({ path: '/v1/locks/account', method: 'DELETE' }));
export const useUpdateLock = (orgId: string | null) =>
  useLockMutation<{ id: string } & LockUpdate>(orgId, ({ id, ...body }) => ({
    path: `/v1/locks/${id}`,
    method: 'PATCH',
    body,
  }));

export function useDoorCodes(orgId: string | null, reservationId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['door-codes', orgId, reservationId],
    enabled: Boolean(token && orgId && reservationId),
    queryFn: () =>
      apiFetch<{ codes: DoorCode[] }>(`/v1/reservations/${reservationId}/door-codes`, {
        token: token as string,
        orgId,
      }),
    staleTime: 60_000,
  });
}

// Today's overview, after Guesty's dashboard: the day's moves, money by month, the coming days.

export function useOverview(orgId: string | null, range: OverviewRange) {
  const token = useToken();
  return useQuery({
    queryKey: ['overview', orgId, range],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<DailyOverview>(`/v1/overview?range=${range}`, { token: token as string, orgId }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useRevenue(orgId: string | null, month: string | null, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['revenue', orgId, month],
    enabled: Boolean(token && orgId && enabled),
    queryFn: () =>
      apiFetch<Revenue>(`/v1/overview/revenue${month ? `?month=${month}` : ''}`, {
        token: token as string,
        orgId,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useTrends(orgId: string | null, days: 7 | 30) {
  const token = useToken();
  return useQuery({
    queryKey: ['trends', orgId, days],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<Trends>(`/v1/overview/trends?days=${days}`, { token: token as string, orgId }),
    placeholderData: keepPreviousData,
  });
}

// Claims ----------------------------------------------------------------------------------------

export function useClaims(orgId: string | null, view: ClaimView, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['claims', orgId, view],
    enabled: Boolean(token && orgId && enabled),
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<ClaimList>(`/v1/claims?view=${view}`, { token: token as string, orgId }),
  });
}

export function useClaim(orgId: string | null, id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['claim', orgId, id],
    enabled: Boolean(token && orgId && id),
    queryFn: () => apiFetch<Claim>(`/v1/claims/${id}`, { token: token as string, orgId }),
  });
}

/** Every change to a claim answers with the whole claim; keep it and refresh the lists and Today. */
function useClaimMutation<V>(orgId: string | null, run: (token: string, v: V) => Promise<Claim>) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => run(token as string, v),
    onSuccess: (claim) => {
      queryClient.setQueryData(['claim', orgId, claim.id], claim);
      void queryClient.invalidateQueries({ queryKey: ['claims', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['today', orgId] });
    },
  });
}

export function useStartClaim(orgId: string | null) {
  return useClaimMutation<string>(orgId, (token, reservationId) =>
    apiFetch<Claim>('/v1/claims', { token, orgId, method: 'POST', body: { reservationId } }),
  );
}

/** Getting paid for a claim by the guest: keep some of a held deposit, or send a payment link. */
export function useClaimCollect(orgId: string | null, id: string) {
  const keep = useClaimMutation<number>(orgId, (token, amountMinor) =>
    apiFetch<Claim>(`/v1/claims/${id}/keep-deposit`, { token, orgId, method: 'POST', body: { amountMinor } }),
  );
  const link = useClaimMutation<number>(orgId, (token, amountMinor) =>
    apiFetch<Claim>(`/v1/claims/${id}/payment-link`, { token, orgId, method: 'POST', body: { amountMinor } }),
  );
  return { keep, link };
}

export function useUpdateClaim(orgId: string | null, id: string) {
  return useClaimMutation<ClaimUpdate>(orgId, (token, body) =>
    apiFetch<Claim>(`/v1/claims/${id}`, { token, orgId, method: 'PATCH', body }),
  );
}

export function useClaimItems(orgId: string | null, id: string) {
  const add = useClaimMutation<ClaimItemInput>(orgId, (token, body) =>
    apiFetch<Claim>(`/v1/claims/${id}/items`, { token, orgId, method: 'POST', body }),
  );
  const change = useClaimMutation<{ itemId: string } & ClaimItemInput>(orgId, (token, { itemId, ...body }) =>
    apiFetch<Claim>(`/v1/claims/${id}/items/${itemId}`, { token, orgId, method: 'PATCH', body }),
  );
  const remove = useClaimMutation<string>(orgId, (token, itemId) =>
    apiFetch<Claim>(`/v1/claims/${id}/items/${itemId}`, { token, orgId, method: 'DELETE' }),
  );
  return { add, change, remove };
}

export function useRemoveClaimFile(orgId: string | null, id: string) {
  return useClaimMutation<string>(orgId, (token, fileId) =>
    apiFetch<Claim>(`/v1/claims/${id}/files/${fileId}`, { token, orgId, method: 'DELETE' }),
  );
}

/** Sends one file to storage with a ticket from the claim; answers with where it went. */
async function sendClaimFile(
  token: string,
  orgId: string | null,
  claimId: string,
  body: Blob,
  contentType: string,
  name: string,
): Promise<string> {
  const ticket = await apiFetch<PhotoUploadTicket>(`/v1/claims/${claimId}/files/uploads`, {
    token,
    orgId,
    method: 'POST',
    body: { contentType, bytes: body.size },
  });
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach file storage. Check your connection and try again.');
  }
  if (!response.ok) throw new ApiError(response.status, 'upload_failed', `${name} could not be uploaded.`);
  return ticket.path;
}

/** Where and who for a claim photo's stamp; the time comes from the camera. */
export interface ClaimStamp {
  where: string;
  who: string;
}

/**
 * A file onto a claim. Receipts, PDFs and videos go up exactly as chosen. A photo goes up twice:
 * the original untouched, and a copy with when, where and who burned in, the way the team's job
 * photos are; the copy is what the claim shows. A photo the browser can't open (HEIC on some
 * devices) goes up as it is, unstamped.
 */
async function addClaimFile(
  token: string,
  orgId: string | null,
  claimId: string,
  file: File,
  kind: ClaimFileKind,
  where: ClaimStamp | null,
): Promise<Claim> {
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  let stamped: { photo: PreparedPhoto; text: string } | null = null;
  if (kind === 'photo' && where && ACCEPTED.includes(contentType)) {
    try {
      const stamp: PhotoStamp = {
        when: stampWhen(await takenAt(file), new Date()),
        where: where.where,
        who: where.who,
      };
      stamped = { photo: await stampPhoto(await preparePhoto(file, 2560), stamp), text: stampText(stamp) };
    } catch {
      stamped = null;
    }
  }
  if (config.demo) return demoAddClaimFile(orgId, claimId, file, kind, contentType, stamped);
  const originalPath = await sendClaimFile(token, orgId, claimId, file, contentType, file.name);
  const register = stamped
    ? {
        path: await sendClaimFile(token, orgId, claimId, stamped.photo.blob, 'image/jpeg', file.name),
        kind,
        fileName: file.name.slice(0, 200),
        contentType: 'image/jpeg',
        bytes: stamped.photo.blob.size,
        stamp: stamped.text,
        original: { path: originalPath, contentType, bytes: file.size },
      }
    : { path: originalPath, kind, fileName: file.name.slice(0, 200), contentType, bytes: file.size };
  return apiFetch<Claim>(`/v1/claims/${claimId}/files`, { token, orgId, method: 'POST', body: register });
}

/** Uploads files one at a time; one that fails doesn't stop the rest. */
export function useAddClaimFiles(orgId: string | null, claimId: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      files,
      kind,
      stamp,
    }: {
      files: File[];
      kind: ClaimFileKind;
      stamp?: ClaimStamp;
    }) => {
      const problems: string[] = [];
      for (const file of files) {
        try {
          const claim = await addClaimFile(token as string, orgId, claimId, file, kind, stamp ?? null);
          queryClient.setQueryData(['claim', orgId, claimId], claim);
        } catch (error) {
          problems.push(
            error instanceof ApiError ? `${file.name}: ${error.message}` : `${file.name} failed.`,
          );
        }
      }
      return problems;
    },
  });
}

// Owners and expenses ---------------------------------------------------------------------------

export function useOwners(orgId: string | null, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['owners', orgId],
    enabled: Boolean(token && orgId && enabled),
    queryFn: () => apiFetch<OwnerList>('/v1/owners', { token: token as string, orgId }),
  });
}

export function useOwnerMonth(orgId: string | null, id: string | null, month: string) {
  const token = useToken();
  return useQuery({
    queryKey: ['owner-month', orgId, id, month],
    enabled: Boolean(token && orgId && id),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<OwnerMonth>(`/v1/owners/${id}/month?month=${month}`, { token: token as string, orgId }),
  });
}

function useOwnerMutation<V, R>(orgId: string | null, run: (token: string, v: V) => Promise<R>) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => run(token as string, v),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owners', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['owner-month', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['property', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['properties', orgId] });
    },
  });
}

export function useCreateOwner(orgId: string | null) {
  return useOwnerMutation<OwnerInput, Owner>(orgId, (token, body) =>
    apiFetch<Owner>('/v1/owners', { token, orgId, method: 'POST', body }),
  );
}

export function useUpdateOwner(orgId: string | null, id: string) {
  return useOwnerMutation<OwnerUpdate, Owner>(orgId, (token, body) =>
    apiFetch<Owner>(`/v1/owners/${id}`, { token, orgId, method: 'PATCH', body }),
  );
}

export function useRemoveOwner(orgId: string | null, id: string) {
  return useOwnerMutation<void, void>(orgId, (token) =>
    apiFetch<void>(`/v1/owners/${id}`, { token, orgId, method: 'DELETE' }),
  );
}

export function useOwnerHomes(orgId: string | null, id: string) {
  return useOwnerMutation<string[], Owner>(orgId, (token, propertyIds) =>
    apiFetch<Owner>(`/v1/owners/${id}/homes`, { token, orgId, method: 'PUT', body: { propertyIds } }),
  );
}

export function useExpenses(
  orgId: string | null,
  month: string,
  filters: { propertyId?: string; category?: string } = {},
  enabled = true,
) {
  const token = useToken();
  const q = new URLSearchParams({ month });
  if (filters.propertyId) q.set('propertyId', filters.propertyId);
  if (filters.category) q.set('category', filters.category);
  return useQuery({
    queryKey: ['expenses', orgId, q.toString()],
    enabled: Boolean(token && orgId && enabled),
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<ExpenseList>(`/v1/expenses?${q}`, { token: token as string, orgId }),
  });
}

/** After any change to an expense: the lists, an owner's month, and a claim's costs. */
function useExpenseMutation<V, R>(orgId: string | null, run: (token: string, v: V) => Promise<R>) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => run(token as string, v),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['owner-month', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['claim', orgId] });
    },
  });
}

async function putReceipt(
  token: string,
  orgId: string | null,
  expenseId: string,
  file: File,
): Promise<Expense> {
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  if (config.demo) return demoSetReceipt(orgId, expenseId, file, contentType);
  const ticket = await apiFetch<PhotoUploadTicket>(`/v1/expenses/${expenseId}/receipt/uploads`, {
    token,
    orgId,
    method: 'POST',
    body: { contentType, bytes: file.size },
  });
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: file });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach file storage. Check your connection and try again.');
  }
  if (!response.ok)
    throw new ApiError(response.status, 'upload_failed', 'The receipt could not be uploaded.');
  return apiFetch<Expense>(`/v1/expenses/${expenseId}/receipt`, {
    token,
    orgId,
    method: 'PUT',
    body: { path: ticket.path, fileName: file.name.slice(0, 200), contentType, bytes: file.size },
  });
}

/** Saves an expense (new or changed), then its receipt if one was chosen. */
export function useSaveExpense(orgId: string | null) {
  return useExpenseMutation<
    { id?: string; body: ExpenseInput | ExpenseUpdate; receipt?: File | null },
    Expense
  >(orgId, async (token, { id, body, receipt }) => {
    let saved = id
      ? await apiFetch<Expense>(`/v1/expenses/${id}`, { token, orgId, method: 'PATCH', body })
      : await apiFetch<Expense>('/v1/expenses', { token, orgId, method: 'POST', body });
    if (receipt) saved = await putReceipt(token, orgId, saved.id, receipt);
    return saved;
  });
}

export function useRemoveExpense(orgId: string | null) {
  return useExpenseMutation<string, void>(orgId, (token, id) =>
    apiFetch<void>(`/v1/expenses/${id}`, { token, orgId, method: 'DELETE' }),
  );
}

export function useRemoveReceipt(orgId: string | null) {
  return useExpenseMutation<string, Expense>(orgId, (token, id) =>
    apiFetch<Expense>(`/v1/expenses/${id}/receipt`, { token, orgId, method: 'DELETE' }),
  );
}

// Owner statements ------------------------------------------------------------------------------

export function useStatements(orgId: string | null, month: string, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['statements', orgId, month],
    enabled: Boolean(token && orgId && enabled),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<StatementList>(`/v1/statements?month=${month}`, { token: token as string, orgId }),
  });
}

type StatementAction =
  | { kind: 'finalise' }
  | { kind: 'paid'; paidOn: string; paidReference?: string }
  | { kind: 'unpaid' }
  | { kind: 'reopen' };

/** Finalise, mark paid or unpaid, or reopen an owner's month. Answers with the month as it now stands. */
export function useStatementAction(orgId: string | null, ownerId: string, month: string) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: StatementAction) => {
      const base = `/v1/owners/${ownerId}/statements`;
      const t = token as string;
      if (a.kind === 'finalise')
        return apiFetch<OwnerMonth>(base, { token: t, orgId, method: 'POST', body: { month } });
      if (a.kind === 'paid')
        return apiFetch<OwnerMonth>(`${base}/${month}/paid`, {
          token: t,
          orgId,
          method: 'PUT',
          body: { paidOn: a.paidOn, ...(a.paidReference ? { paidReference: a.paidReference } : {}) },
        });
      if (a.kind === 'unpaid')
        return apiFetch<OwnerMonth>(`${base}/${month}/paid`, { token: t, orgId, method: 'DELETE' });
      return apiFetch<OwnerMonth>(`${base}/${month}`, { token: t, orgId, method: 'DELETE' });
    },
    onSuccess: (m) => {
      queryClient.setQueryData(['owner-month', orgId, ownerId, month], m);
      void queryClient.invalidateQueries({ queryKey: ['statements', orgId] });
    },
  });
}

// Insights --------------------------------------------------------------------------------------

export function useInsights(orgId: string | null, from: string, to: string, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['insights', orgId, from, to],
    enabled: Boolean(token && orgId && enabled && from && to),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<Insights>(`/v1/insights?from=${from}&to=${to}`, { token: token as string, orgId }),
  });
}

// Access by home and the owner log-in (1 Nov 2026) ------------------------------------------------

export function useMemberHomes(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string } & MemberHomes) =>
      apiFetch<TeamMember>(`/v1/members/${userId}/homes`, {
        token: token as string,
        orgId,
        method: 'PUT',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team', orgId] }),
  });
}

export function useMemberSkills(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string } & MemberSkills) =>
      apiFetch<TeamMember>(`/v1/members/${userId}/skills`, {
        token: token as string,
        orgId,
        method: 'PUT',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team', orgId] }),
  });
}

/** The people on the Guesty account, to bring onto the team. */
export function useGuestyPeople(orgId: string | null, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: ['guesty-people', orgId],
    enabled: Boolean(token && orgId && enabled),
    queryFn: () => apiFetch<GuestyPeople>('/v1/team/guesty', { token: token as string, orgId }),
  });
}

export function useAddGuestyPeople(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GuestyPeopleAdd) =>
      apiFetch<GuestyPeopleAdded>('/v1/team/guesty', { token: token as string, orgId, method: 'POST', body }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['guesty-people', orgId] }),
      ]);
    },
  });
}

export function useGiveOwnerLogin(orgId: string | null, id: string) {
  return useOwnerMutation<OwnerLoginInvite, Owner>(orgId, (token, body) =>
    apiFetch<Owner>(`/v1/owners/${id}/logins`, { token, orgId, method: 'POST', body }),
  );
}

export function useRemoveOwnerLogin(orgId: string | null, id: string) {
  return useOwnerMutation<string, Owner>(orgId, (token, userId) =>
    apiFetch<Owner>(`/v1/owners/${id}/logins/${userId}`, { token, orgId, method: 'DELETE' }),
  );
}

export function useCancelOwnerInvitation(orgId: string | null, id: string) {
  return useOwnerMutation<string, Owner>(orgId, (token, invitationId) =>
    apiFetch<Owner>(`/v1/owners/${id}/invitations/${invitationId}`, { token, orgId, method: 'DELETE' }),
  );
}

export function usePortal(orgId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['portal', orgId],
    enabled: Boolean(token && orgId),
    queryFn: () => apiFetch<Portal>('/v1/portal', { token: token as string, orgId }),
  });
}

export function usePortalCalendar(orgId: string | null, from: string, to: string) {
  const token = useToken();
  return useQuery({
    queryKey: ['portal-calendar', orgId, from, to],
    enabled: Boolean(token && orgId),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<PortalCalendar>(`/v1/portal/calendar?from=${from}&to=${to}`, {
        token: token as string,
        orgId,
      }),
  });
}

export function usePortalStatement(orgId: string | null, month: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['portal-statement', orgId, month],
    enabled: Boolean(token && orgId && month),
    queryFn: () => apiFetch<OwnerMonth>(`/v1/portal/statements/${month}`, { token: token as string, orgId }),
  });
}

/** Give a home to an owner (or none), from the Owners page's list of homes without one. */
export function useGiveHome(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, ownerId }: { propertyId: string; ownerId: string | null }) =>
      apiFetch(`/v1/properties/${propertyId}`, {
        token: token as string,
        orgId,
        method: 'PATCH',
        body: { ownerId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owners', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['properties', orgId] });
    },
  });
}

export function useInviteOwners(orgId: string | null) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OwnerLoginBulk) =>
      apiFetch<OwnerLoginBulkResult>('/v1/owner-logins', {
        token: token as string,
        orgId,
        method: 'POST',
        body,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['owners', orgId] }),
  });
}

// Owners' contracts, each home's terms and payee (1 Nov 2026) --------------------------------------

export function useOwnerSetup(orgId: string | null, ownerId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: ['owner-setup', orgId, ownerId],
    enabled: Boolean(token && orgId && ownerId),
    queryFn: () => apiFetch<OwnerSetup>(`/v1/owners/${ownerId}/setup`, { token: token as string, orgId }),
  });
}

/** After any change to terms, contracts, payees or costs: the set-up, the owners and their months. */
function useSetupMutation<V, R>(orgId: string | null, run: (token: string, v: V) => Promise<R>) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => run(token as string, v),
    onSuccess: () => {
      for (const key of ['owner-setup', 'owners', 'owner-month', 'statements'])
        void queryClient.invalidateQueries({ queryKey: [key, orgId] });
    },
  });
}

async function putContractFile(
  token: string,
  orgId: string | null,
  ownerId: string,
  contractId: string,
  file: File,
) {
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  if (config.demo) return demoSetContractFile(orgId, ownerId, contractId, file, contentType);
  const base = `/v1/owners/${ownerId}/contracts/${contractId}`;
  const ticket = await apiFetch<PhotoUploadTicket>(`${base}/uploads`, {
    token,
    orgId,
    method: 'POST',
    body: { contentType, bytes: file.size },
  });
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: file });
  } catch {
    throw new ApiError(0, 'offline', 'Cannot reach file storage. Check your connection and try again.');
  }
  if (!response.ok)
    throw new ApiError(response.status, 'upload_failed', 'The contract could not be uploaded.');
  return apiFetch<Contract>(`${base}/file`, {
    token,
    orgId,
    method: 'PUT',
    body: { path: ticket.path, fileName: file.name.slice(0, 200), contentType, bytes: file.size },
  });
}

export function useSaveContract(orgId: string | null, ownerId: string) {
  return useSetupMutation<{ id?: string; body: ContractInput; file?: File | null }, Contract>(
    orgId,
    async (token, { id, body, file }) => {
      let saved = id
        ? await apiFetch<Contract>(`/v1/owners/${ownerId}/contracts/${id}`, {
            token,
            orgId,
            method: 'PATCH',
            body,
          })
        : await apiFetch<Contract>(`/v1/owners/${ownerId}/contracts`, { token, orgId, method: 'POST', body });
      if (file) saved = await putContractFile(token, orgId, ownerId, saved.id, file);
      return saved;
    },
  );
}

export function useRemoveContract(orgId: string | null, ownerId: string) {
  return useSetupMutation<string, void>(orgId, (token, id) =>
    apiFetch<void>(`/v1/owners/${ownerId}/contracts/${id}`, { token, orgId, method: 'DELETE' }),
  );
}

export async function contractLink(token: string, orgId: string | null, ownerId: string, id: string) {
  return apiFetch<{ url: string }>(`/v1/owners/${ownerId}/contracts/${id}/file`, { token, orgId });
}

export function useSaveHomeSetup(orgId: string | null) {
  return useSetupMutation<
    {
      propertyId: string;
      terms?: HomeTermsInput;
      payee?: PayeeInput | null;
      cleaningCostMinor?: number | null;
    },
    void
  >(orgId, async (token, { propertyId, terms, payee, cleaningCostMinor }) => {
    const base = `/v1/properties/${propertyId}`;
    if (terms) await apiFetch<HomeTerms>(`${base}/terms`, { token, orgId, method: 'PUT', body: terms });
    if (payee) await apiFetch<Payee>(`${base}/payee`, { token, orgId, method: 'PUT', body: payee });
    if (payee === null) await apiFetch<void>(`${base}/payee`, { token, orgId, method: 'DELETE' });
    if (cleaningCostMinor !== undefined)
      await apiFetch(`${base}/cleaning-cost`, { token, orgId, method: 'PUT', body: { cleaningCostMinor } });
  });
}

export function useBankDetails(orgId: string | null) {
  const token = useToken();
  return useMutation({
    mutationFn: (propertyId: string) =>
      apiFetch<BankDetails>(`/v1/properties/${propertyId}/payee/bank`, { token: token as string, orgId }),
  });
}

export { useToken };
