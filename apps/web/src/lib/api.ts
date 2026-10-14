import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConsoleOperatorDetail,
  ConsoleOperatorList,
  ConsoleOverview,
  ConsoleSync,
  Me,
  Property,
  PropertyCreate,
  PropertyList,
  SupportAccessStart,
  SupportGrant,
  SupportGrantList,
  SupportVisitList,
  Workspace,
} from '@v01/shared';
import { config } from './config.ts';
import { demoFetch } from './demo.ts';
import { ApiError } from './errors.ts';
import { useSession } from './session.tsx';

export { ApiError };

async function apiFetch<T>(
  path: string,
  options: { token: string; orgId?: string | null; method?: 'GET' | 'POST'; body?: unknown },
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
      apiFetch<Property>('/v1/properties', { token: token as string, orgId, method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties', orgId] }),
  });
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
