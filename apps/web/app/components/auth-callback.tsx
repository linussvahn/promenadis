import { translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useStoredLocale } from "../lib/locale";
import { getBrowserAuthClient } from "../lib/supabase";
import { Eyebrow } from "./page";

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
    <main
      className="mx-auto grid min-h-screen w-[min(100%-2rem,28rem)] content-center justify-items-center gap-3 py-16 text-center"
      id="main"
      tabIndex={-1}
    >
      <Eyebrow>Promenadis</Eyebrow>
      <h1 className="text-3xl font-extrabold tracking-tight">
        {failed ? translate(locale, "auth.error") : translate(locale, "auth.callback")}
      </h1>
      {failed ? (
        <a className="font-semibold" href="/sign-in">
          {translate(locale, "nav.signIn")}
        </a>
      ) : (
        <p aria-live="polite" className="text-muted-foreground">
          {translate(locale, "common.loading")}
        </p>
      )}
    </main>
  );
}
