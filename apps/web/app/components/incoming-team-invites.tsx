import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { IncomingEventTeamInviteSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

export function IncomingTeamInvites({
  displayName,
  locale,
  onAccepted,
}: {
  readonly displayName: string;
  readonly locale: Locale;
  readonly onAccepted: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busy, setBusy] = useState<string | null>(null);
  const [invites, setInvites] = useState<IncomingEventTeamInviteSummary[]>([]);
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
          setInvites(await authenticated.api.getIncomingEventTeamInvites(authenticated.token));
        }
      } catch {
        setStatus(translate(locale, "team.incomingError"));
      }
    })();
  }, [authenticatedClient, locale]);

  const accept = async (formEvent: FormEvent<HTMLFormElement>, inviteId: string) => {
    formEvent.preventDefault();
    const memberName = String(new FormData(formEvent.currentTarget).get("displayName") ?? "");
    setBusy(inviteId);
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      await authenticated.api.acceptEventTeamInvite(authenticated.token, inviteId, {
        displayName: memberName,
      });
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      await onAccepted();
      setStatus(translate(locale, "team.accepted"));
    } catch (error) {
      setStatus(
        error instanceof PromenadisApiError && error.code === "invite_unavailable"
          ? translate(locale, "team.inviteUnavailable")
          : translate(locale, "team.error"),
      );
    } finally {
      setBusy(null);
    }
  };

  if (invites.length === 0 && !status) return null;

  return (
    <section aria-labelledby="incoming-team-invites-heading" className="incoming-invites panel">
      <h2 id="incoming-team-invites-heading">{translate(locale, "team.incomingTitle")}</h2>
      {invites.length > 0 ? (
        <ul className="incoming-invite-list">
          {invites.map((invite) => (
            <li key={invite.id}>
              <div className="team-member-copy">
                <strong>{invite.eventTitle}</strong>
                <span>{invite.organizerDisplayName}</span>
                <span>
                  {translate(locale, `team.role.${invite.role}`)} ·{" "}
                  {translate(locale, "team.expires")}{" "}
                  {formatDateTime(locale, invite.expiresAt, "Europe/Stockholm")}
                </span>
              </div>
              <form onSubmit={(formEvent) => void accept(formEvent, invite.id)}>
                <label className="team-control-label" htmlFor={`invite-display-name-${invite.id}`}>
                  {translate(locale, "team.acceptDisplayName")}
                </label>
                <input
                  defaultValue={displayName}
                  disabled={busy !== null}
                  id={`invite-display-name-${invite.id}`}
                  name="displayName"
                  required
                />
                <button className="primary-button" disabled={busy !== null} type="submit">
                  {busy === invite.id
                    ? translate(locale, "team.accepting")
                    : translate(locale, "team.accept")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </section>
  );
}
