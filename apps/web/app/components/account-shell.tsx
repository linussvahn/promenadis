import { type Locale, translate } from "@promenadis/i18n";
import { type ReactNode, useEffect, useState } from "react";
import { AccountSessionContext, subscribeSessionChanges } from "../lib/account-session";
import { Link, useNavigate } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getBrowserAuthClient, hasLocalBackendConfiguration } from "../lib/supabase";
import { PageMain, siteShell, skipLink } from "./page";
import { headerNavItem, PageHeader } from "./page-header";
import { Alert } from "./ui/alert";

export function AccountShell({
  children,
}: {
  readonly children: (context: { readonly locale: Locale }) => ReactNode;
}) {
  const navigate = useNavigate();
  const { locale, setLocale } = useStoredLocale();
  const [signingOut, setSigningOut] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      const auth = getBrowserAuthClient();
      if (!auth) return;
      const { data, error } = await auth.auth.getSession();
      if (!active || current !== version) return;
      setFailed(Boolean(error));
      setAccountId(error ? null : (data.session?.user.id ?? null));
      if (!error && !data.session) void navigate("/sign-in", { replace: true });
    };
    const unsubscribe = subscribeSessionChanges(() => {
      void refresh();
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [navigate]);

  const signOut = async () => {
    const supabase = getBrowserAuthClient(accountId);
    if (!supabase) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setFailed(true);
      setSigningOut(false);
      return;
    }
    await navigate("/sign-in", { replace: true });
  };

  const accountNavigation = (
    <nav aria-label={translate(locale, "account.navigation")}>
      <Link className={headerNavItem} to="/dashboard">
        {translate(locale, "nav.dashboard")}
      </Link>
      <Link className={headerNavItem} to="/settings">
        {translate(locale, "nav.settings")}
      </Link>
      <button
        className={headerNavItem}
        disabled={signingOut || !accountId}
        onClick={signOut}
        type="button"
      >
        {translate(locale, "dashboard.signOut")}
      </button>
    </nav>
  );

  return (
    <div className={siteShell}>
      <a className={skipLink} href="#main">
        {translate(locale, "home.skip")}
      </a>
      <PageHeader action={accountNavigation} locale={locale} onLocaleChange={setLocale} />
      {!hasLocalBackendConfiguration() ? (
        <PageMain>
          <Alert role="alert" variant="destructive">
            {translate(locale, "auth.configMissing")}
          </Alert>
        </PageMain>
      ) : accountId ? (
        <AccountSessionContext.Provider key={accountId} value={accountId}>
          {children({ locale })}
        </AccountSessionContext.Provider>
      ) : (
        <PageMain>
          <p role={failed ? "alert" : "status"}>
            {translate(locale, failed ? "auth.error" : "common.loading")}
          </p>
        </PageMain>
      )}
    </div>
  );
}
