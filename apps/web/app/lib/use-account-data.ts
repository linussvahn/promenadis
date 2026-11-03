import { PromenadisApiError } from "@promenadis/api-client";
import type { IdentityDashboard } from "@promenadis/contracts";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useExpectedAccountId } from "./account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "./supabase";

export function useAccountData() {
  const expectedAccountId = useExpectedAccountId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [deletionPending, setDeletionPending] = useState(false);
  const [dashboard, setDashboard] = useState<IdentityDashboard | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const accessToken = useCallback(async () => {
    // Cookie-mode API calls carry this expected account ID, never a Supabase token.
    const supabase = getBrowserAuthClient(expectedAccountId);
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (!data.session) {
      if (!error) await navigate("/sign-in", { replace: true });
      else if (error.status !== 409) setLoadFailed(true);
      return null;
    }
    return data.session.user.id;
  }, [navigate, expectedAccountId]);

  const loadDashboard = useCallback(async () => {
    const api = getPromenadisApiClient();
    if (!api) return;
    const token = await accessToken();
    if (!token) return;
    try {
      setDashboard(await api.getDashboard(token));
      setDeletionPending(false);
      setLoadFailed(false);
    } catch (error) {
      // A disabled account can only review or cancel its deletion in Settings.
      if (error instanceof PromenadisApiError && error.code === "mfa_required") {
        await navigate("/sign-in?step=mfa", { replace: true });
        return;
      }
      if (error instanceof PromenadisApiError && error.code === "account_deletion_pending") {
        setDeletionPending(true);
        if (pathname !== "/settings") await navigate("/settings", { replace: true });
        return;
      }
      setLoadFailed(true);
    }
  }, [accessToken, navigate, pathname]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  return {
    accessToken,
    dashboard,
    deletionPending,
    loadDashboard,
    loadFailed,
    setDashboard,
  } as const;
}
