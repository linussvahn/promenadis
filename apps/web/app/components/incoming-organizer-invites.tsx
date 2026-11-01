import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { IncomingOrganizerInviteSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

export function IncomingOrganizerInvites({
  displayName,
  locale,
  onAccepted,
}: {
  readonly displayName: string;
  readonly locale: Locale;
  readonly onAccepted: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [invites, setInvites] = useState<IncomingOrganizerInviteSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  useEffect(() => {
    void (async () => {
      try {
        const authenticated = await authenticatedClient();
        if (authenticated) {
          setInvites(await authenticated.api.getIncomingOrganizerInvites(authenticated.token));
        }
      } catch {
        setStatus(translate(locale, "organizerTeam.incomingError"));
      }
    })();
  }, [authenticatedClient, locale]);

  const accept = async (formEvent: FormEvent<HTMLFormElement>, inviteId: string) => {
    formEvent.preventDefault();
    setBusy(inviteId);
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      await authenticated.api.acceptOrganizerManagerInvite(authenticated.token, inviteId, {
        displayName: String(new FormData(formEvent.currentTarget).get("displayName") ?? ""),
      });
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      await onAccepted();
      setStatus(translate(locale, "organizerTeam.accepted"));
    } catch (error) {
      setStatus(
        error instanceof PromenadisApiError && error.code === "invite_unavailable"
          ? translate(locale, "team.inviteUnavailable")
          : translate(locale, "organizerTeam.error"),
      );
    } finally {
      setBusy(null);
    }
  };

  if (invites.length === 0 && !status) return null;
  return (
    <section aria-labelledby="incoming-organizer-invites-heading" className="panel invite-panel">
      <h2 id="incoming-organizer-invites-heading">
        {translate(locale, "organizerTeam.incomingTitle")}
      </h2>
      <ul className="incoming-invite-list">
        {invites.map((invite) => (
          <li key={invite.id}>
            <div className="team-member-copy">
              <strong>{invite.organizerDisplayName}</strong>
              <span>
                {translate(locale, "team.expires")}{" "}
                {formatDateTime(locale, invite.expiresAt, "Europe/Stockholm")}
              </span>
            </div>
            <form onSubmit={(event) => void accept(event, invite.id)}>
              <label htmlFor={`organizer-invite-name-${invite.id}`}>
                {translate(locale, "organizerTeam.displayName")}
              </label>
              <input
                defaultValue={displayName}
                id={`organizer-invite-name-${invite.id}`}
                maxLength={80}
                name="displayName"
                required
              />
              <button className="primary-button" disabled={busy !== null} type="submit">
                {translate(locale, "organizerTeam.accept")}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
