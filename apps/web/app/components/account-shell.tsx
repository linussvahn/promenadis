import { type Locale, translate } from "@promenadis/i18n";
import { type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router";
import { AccountSessionContext } from "../lib/account-session";
import { useStoredLocale } from "../lib/locale";
import { hasLocalBackendConfiguration } from "../lib/supabase";
import { PageMain } from "./page";
import { SiteFrame, useSiteSession } from "./site-frame";
import { Alert } from "./ui/alert";

export function AccountShell({
  children,
}: {
  readonly children: (context: { readonly locale: Locale }) => ReactNode;
}) {
  const { locale, setLocale } = useStoredLocale();
  return (
    <SiteFrame locale={locale} onLocaleChange={setLocale}>
      <AccountContent locale={locale}>{children}</AccountContent>
    </SiteFrame>
  );
}

function AccountContent({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: (context: { readonly locale: Locale }) => ReactNode;
}) {
  const navigate = useNavigate();
  const { accountId, failed } = useSiteSession();

  useEffect(() => {
    if (accountId === null && !failed) void navigate("/sign-in", { replace: true });
  }, [accountId, failed, navigate]);

  if (!hasLocalBackendConfiguration()) {
    return (
      <PageMain>
        <Alert role="alert" variant="destructive">
          {translate(locale, "auth.configMissing")}
        </Alert>
      </PageMain>
    );
  }
  if (!accountId) {
    return (
      <PageMain>
        <p role={failed ? "alert" : "status"}>
          {translate(locale, failed ? "auth.error" : "common.loading")}
        </p>
      </PageMain>
    );
  }
  return (
    <AccountSessionContext.Provider key={accountId} value={accountId}>
      {children({ locale })}
    </AccountSessionContext.Provider>
  );
}
