import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Calendar,
  CalendarChange,
  CalendarChangeResult,
  ConsoleOperatorDetail,
  ConsoleOperatorList,
  ConsoleOverview,
  ConsoleSync,
  Me,
  PhotoUploadTicket,
  PropertyCreate,
  PropertyDetail,
  PropertyList,
  PropertyUpdate,
  RoomInput,
  SupportAccessStart,
  SupportGrant,
  SupportGrantList,
  SupportVisitList,
  Workspace,
} from '@v01/shared';
import { config } from './config.ts';
import { demoAddPhoto, demoFetch } from './demo.ts';
import { ApiError } from './errors.ts';
import { PhotoError, type PreparedPhoto, preparePhoto } from './images.ts';
import { useSession } from './session.tsx';

export { ApiError };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function apiFetch<T>(
  path: string,
  options: { token: string; orgId?: string | null; method?: Method; body?: unknown },
): Promise<T> {
  if (config.demo) return demoFetch<T>(path, options);
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}` };
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
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'error',
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

/**
 * Every property's nights from `from` to `to`, optionally only properties free for a stay. The last
 * window stays on screen while the next loads.
 */
export function useCalendar(
  orgId: string | null,
  from: string,
  to: string,
  free?: { from: string; to: string; guests: number } | null,
) {
  const token = useToken();
  const query = new URLSearchParams({ from, to });
  if (free) {
    query.set('freeFrom', free.from);
    query.set('freeTo', free.to);
    query.set('guests', String(free.guests));
  }
  return useQuery({
    queryKey: ['calendar', orgId, query.toString()],
    enabled: Boolean(token && orgId),
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<Calendar>(`/v1/calendar?${query}`, { token: token as string, orgId }),
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
