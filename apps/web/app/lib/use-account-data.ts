import type { IdentityDashboard } from "@promenadis/contracts";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { getPromenadisApiClient, getBrowserAuthClient } from "./supabase";
import { useExpectedAccountId } from "./account-session";

export function useAccountData() {
  const expectedAccountId = useExpectedAccountId();
  const navigate = useNavigate();
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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  return { accessToken, dashboard, loadDashboard, loadFailed, setDashboard } as const;
}
