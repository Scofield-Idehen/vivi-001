import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountListingList,
  BrandUpdate,
  Calendar,
  CalendarChange,
  CalendarChangeResult,
  ChannelAccount,
  ChannelAccountConnect,
  ChannelAccountCreate,
  ChannelAccountList,
  ChannexState,
  ChargeCreate,
  CleaningState,
  CleaningUpdate,
  ConnectAllResult,
  ConsoleOperatorDetail,
  ConsoleOperatorList,
  ConsoleOverview,
  ConsoleSync,
  CustomField,
  CustomFieldCreate,
  CustomFieldList,
  CustomFieldUpdate,
  DamageReport,
  GuestLink,
  GuestStay,
  Invitation,
  InvitationList,
  Invite,
  InviteResult,
  Me,
  MemberRoleUpdate,
  MessageSend,
  MessageTemplate,
  MessageTemplateCreate,
  MessageTemplateList,
  MessageTemplateUpdate,
  MeUpdate,
  PaymentCreate,
  PhotoStage,
  PhotoUploadTicket,
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
  RoomInput,
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
  Workspace,
  WorkspaceSync,
} from '@v01/shared';
import { config } from './config.ts';
import { demoAddPhoto, demoAddTaskPhoto, demoFetch } from './demo.ts';
import { ApiError } from './errors.ts';
import {
  PhotoError,
  type PhotoStamp,
  type PreparedPhoto,
  preparePhoto,
  stampPhoto,
  stampText,
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
