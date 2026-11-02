import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary, EventPublicLink as PublicLink } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";

// The visitor link of an event. Owners can replace a leaked unlisted link;
// the old one then answers 410 Gone without redirecting.
export function EventPublicLink({
  event,
  locale,
  onChanged,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onChanged: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [link, setLink] = useState<PublicLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  // Reload whenever the event version changes (publish, rotation, edits).
  // biome-ignore lint/correctness/useExhaustiveDependencies: event.version is the reload trigger.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return;
      try {
        const loaded = await authenticated.api.getEventPublicLink(authenticated.token, event.id);
        if (!cancelled) setLink(loaded);
      } catch {
        if (!cancelled) setStatus(translate(locale, "publication.error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticatedClient, event.id, event.version, locale]);

  if (!link) return null;
  const url = `${window.location.origin}/${link.visibility === "public" ? "e" : "u"}/${link.publicKey}`;
  const canRotate =
    event.role === "owner" &&
    link.visibility === "unlisted" &&
    ["draft", "published", "postponed", "active"].includes(link.state);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus(translate(locale, "publicLink.copied"));
    } catch {
      setStatus(url);
    }
  };

  const rotate = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const reason = String(new FormData(formEvent.currentTarget).get("safetyReason") ?? "").trim();
    setBusy(true);
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) return;
      setLink(
        await authenticated.api.rotateUnlistedLink(authenticated.token, event.id, {
          expectedEventVersion: event.version,
          ...(reason ? { safetyReason: reason } : {}),
        }),
      );
      setStatus(translate(locale, "publicLink.rotated"));
      await onChanged();
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "lifecycle.recentAuth"
            : code === "version_conflict"
              ? "event.versionConflict"
              : "lifecycle.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="public-link-heading" className="panel">
      <h3 id="public-link-heading">{translate(locale, "publicLink.title")}</h3>
      {link.live ? null : <p className="field-hint">{translate(locale, "publicLink.draft")}</p>}
      <p>
        <code className="public-link-url">{url}</code>
      </p>
      <button className="button button-secondary" onClick={() => void copy()} type="button">
        {translate(locale, "publicLink.copy")}
      </button>
      {link.visibility === "unlisted" ? (
        <p className="field-hint">
          {translate(locale, "public.unlistedNotice")}{" "}
          {translate(locale, "publicLink.previewWarning")}
        </p>
      ) : null}
      {canRotate ? (
        <form className="form-panel" onSubmit={(formEvent) => void rotate(formEvent)}>
          <p className="field-hint">{translate(locale, "publicLink.rotateIntro")}</p>
          {link.state === "active" ? (
            <>
              <label htmlFor="rotate-safety-reason">
                {translate(locale, "publicLink.safetyReason")}
              </label>
              <input id="rotate-safety-reason" maxLength={500} name="safetyReason" required />
            </>
          ) : null}
          <button className="button button-secondary" disabled={busy} type="submit">
            {translate(locale, "publicLink.rotate")}
          </button>
        </form>
      ) : null}
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
