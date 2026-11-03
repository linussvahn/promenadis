import { PromenadisApiError } from "@promenadis/api-client";
import type { IdentityDashboard } from "@promenadis/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useExpectedAccountId } from "./account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "./supabase";

/** Query keys always start with the account, so one account never sees another's cache. */
export const accountKey = (accountId: string | null, ...rest: readonly unknown[]) =>
  ["account", accountId, ...rest] as const;

export function useAccountData() {
  const expectedAccountId = useExpectedAccountId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();

  const accessToken = useCallback(async () => {
    // Cookie-mode API calls carry this expected account ID, never a Supabase token.
    const supabase = getBrowserAuthClient(expectedAccountId);
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (!data.session) {
      if (!error) await navigate({ replace: true, to: "/sign-in" });
      else if (error.status !== 409) throw new Error("session");
      return null;
    }
    return data.session.user.id;
  }, [navigate, expectedAccountId]);

  const dashboardKey = accountKey(expectedAccountId, "dashboard");
  const query = useQuery({
    queryKey: dashboardKey,
    queryFn: async (): Promise<{
      dashboard: IdentityDashboard | null;
      deletionPending: boolean;
    }> => {
      const api = getPromenadisApiClient();
      if (!api) return { dashboard: null, deletionPending: false };
      const token = await accessToken();
      if (!token) return { dashboard: null, deletionPending: false };
      try {
        return { dashboard: await api.getDashboard(token), deletionPending: false };
      } catch (error) {
        // A disabled account can only review or cancel its deletion in Settings.
        if (error instanceof PromenadisApiError && error.code === "mfa_required") {
          await navigate({ replace: true, search: { step: "mfa" }, to: "/sign-in" });
          return { dashboard: null, deletionPending: false };
        }
        if (error instanceof PromenadisApiError && error.code === "account_deletion_pending") {
          if (pathname !== "/settings") await navigate({ replace: true, to: "/settings" });
          return { dashboard: null, deletionPending: true };
        }
        throw error;
      }
    },
    retry: false,
  });

  const loadDashboard = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  const setDashboard = useCallback(
    (next: IdentityDashboard | ((current: IdentityDashboard | null) => IdentityDashboard | null)) =>
      queryClient.setQueryData<{ dashboard: IdentityDashboard | null; deletionPending: boolean }>(
        dashboardKey,
        (current) => ({
          dashboard: typeof next === "function" ? next(current?.dashboard ?? null) : next,
          deletionPending: current?.deletionPending ?? false,
        }),
      ),
    [queryClient, dashboardKey],
  );

  return {
    accessToken,
    dashboard: query.data?.dashboard ?? null,
    deletionPending: query.data?.deletionPending ?? false,
    loadDashboard,
    loadFailed: query.isError,
    setDashboard,
  } as const;
}
