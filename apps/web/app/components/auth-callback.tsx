import { translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getBrowserAuthClient } from "../lib/supabase";

export function AuthCallback() {
  const navigate = useNavigate();
  const { locale } = useStoredLocale();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const complete = async () => {
      const supabase = getBrowserAuthClient();
      if (!supabase) {
        setFailed(true);
        return;
      }

      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) {
        setFailed(true);
        return;
      }
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setFailed(true);
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setFailed(true);
        return;
      }
      await navigate("/dashboard", { replace: true });
    };

    void complete();
  }, [navigate]);

  return (
    <main className="callback-page" id="main" tabIndex={-1}>
      <p className="eyebrow">Promenadis</p>
      <h1>{failed ? translate(locale, "auth.error") : translate(locale, "auth.callback")}</h1>
      {failed ? (
        <a href="/sign-in">{translate(locale, "nav.signIn")}</a>
      ) : (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      )}
    </main>
  );
}
