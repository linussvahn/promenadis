import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { OrganizerTeamSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

export function OrganizerTeam({
  locale,
  organizerProfileId,
  owner,
}: {
  readonly locale: Locale;
  readonly organizerProfileId: string;
  readonly owner: boolean;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState<OrganizerTeamSummary | null>(null);

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  const load = useCallback(async () => {
    try {
      const authenticated = await authenticatedClient();
      if (authenticated) {
        setTeam(await authenticated.api.getOrganizerTeam(authenticated.token, organizerProfileId));
      }
    } catch {
      setStatus(translate(locale, "organizerTeam.error"));
    }
  }, [authenticatedClient, locale, organizerProfileId]);

  useEffect(() => void load(), [load]);

  const message = (error: unknown) => {
    if (error instanceof PromenadisApiError && error.code === "recent_auth_required") {
      return translate(locale, "team.recentAuth");
    }
    if (error instanceof PromenadisApiError && error.code === "version_conflict") {
      void load();
      return translate(locale, "organizerTeam.versionConflict");
    }
    return translate(locale, "organizerTeam.error");
  };

  const invite = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!team) return;
    const form = formEvent.currentTarget;
    setBusy("invite");
    setStatus("");
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      setTeam(
        await authenticated.api.inviteOrganizerManager(authenticated.token, organizerProfileId, {
          email: String(new FormData(form).get("email") ?? ""),
          expectedTeamVersion: team.teamVersion,
        }),
      );
      form.reset();
      setStatus(translate(locale, "organizerTeam.invited"));
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(null);
    }
  };

  const cancelInvite = async (inviteId: string) => {
    if (!team) return;
    setBusy(inviteId);
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      setTeam(
        await authenticated.api.cancelOrganizerManagerInvite(
          authenticated.token,
          organizerProfileId,
          inviteId,
          { expectedTeamVersion: team.teamVersion },
        ),
      );
      setStatus(translate(locale, "organizerTeam.inviteCancelled"));
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (membershipId: string) => {
    if (!team) return;
    setBusy(membershipId);
    try {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      setTeam(
        await authenticated.api.removeOrganizerManager(
          authenticated.token,
          organizerProfileId,
          membershipId,
          { expectedTeamVersion: team.teamVersion },
        ),
      );
      setConfirmingRemoval(null);
      setStatus(translate(locale, "organizerTeam.removed"));
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="organizer-team">
      <h3>{translate(locale, "organizerTeam.title")}</h3>
      {!team ? (
        <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
      ) : (
        <>
          <ul className="team-list">
            {team.members.map((member) => (
              <li key={member.id}>
                <div className="team-member-copy">
                  <strong>{member.displayName}</strong>
                  <span>{translate(locale, `organizerTeam.role.${member.role}`)}</span>
                </div>
                {owner && member.role === "manager" ? (
                  confirmingRemoval === member.id ? (
                    <div className="inline-control">
                      <button
                        className="danger-button"
                        disabled={busy !== null}
                        onClick={() => void remove(member.id)}
                        type="button"
                      >
                        {translate(locale, "organizerTeam.confirmRemove")}
                      </button>
                      <button
                        className="quiet-button"
                        onClick={() => setConfirmingRemoval(null)}
                        type="button"
                      >
                        {translate(locale, "common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="danger-button"
                      disabled={busy !== null}
                      onClick={() => setConfirmingRemoval(member.id)}
                      type="button"
                    >
                      {translate(locale, "organizerTeam.remove")}
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
          {owner ? (
            <>
              <form className="team-invite-form" onSubmit={invite}>
                <label
                  className="team-control-label"
                  htmlFor={`organizer-invite-${organizerProfileId}`}
                >
                  {translate(locale, "organizerTeam.invite")}
                </label>
                <input
                  id={`organizer-invite-${organizerProfileId}`}
                  name="email"
                  required
                  type="email"
                />
                <button className="secondary-button" disabled={busy !== null} type="submit">
                  {translate(locale, "organizerTeam.send")}
                </button>
              </form>
              {team.pendingInvites.length > 0 ? (
                <ul className="team-list">
                  {team.pendingInvites.map((inviteItem) => (
                    <li key={inviteItem.id}>
                      <div className="team-member-copy">
                        <strong>{inviteItem.email}</strong>
                        <span>
                          {translate(locale, "team.expires")}{" "}
                          {formatDateTime(locale, inviteItem.expiresAt, "Europe/Stockholm")}
                        </span>
                      </div>
                      <button
                        className="secondary-button"
                        disabled={busy !== null}
                        onClick={() => void cancelInvite(inviteItem.id)}
                        type="button"
                      >
                        {translate(locale, "team.cancelInvite")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      )}
      <p aria-live="polite" className="form-status">
        {team ? status : ""}
      </p>
    </div>
  );
}
