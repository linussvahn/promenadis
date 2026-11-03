import { PromenadisApiError } from "@promenadis/api-client";
import type { OrganizerTeamSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
    <div className="grid gap-3">
      <h3 className="text-base font-bold">{translate(locale, "organizerTeam.title")}</h3>
      {!team ? (
        <p aria-live="polite">{status || translate(locale, "common.loading")}</p>
      ) : (
        <>
          <ul className="m-0 grid list-none divide-y border-y p-0">
            {team.members.map((member) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3"
                key={member.id}
              >
                <div className="grid gap-0.5">
                  <strong>{member.displayName}</strong>
                  <span className="text-sm text-muted-foreground">
                    {translate(locale, `organizerTeam.role.${member.role}`)}
                  </span>
                </div>
                {owner && member.role === "manager" ? (
                  confirmingRemoval === member.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        disabled={busy !== null}
                        onClick={() => void remove(member.id)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {translate(locale, "organizerTeam.confirmRemove")}
                      </Button>
                      <Button
                        onClick={() => setConfirmingRemoval(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {translate(locale, "common.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className="text-destructive-foreground hover:bg-destructive-soft"
                      disabled={busy !== null}
                      onClick={() => setConfirmingRemoval(member.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {translate(locale, "organizerTeam.remove")}
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
          {owner ? (
            <>
              <form className="grid max-w-md gap-2" onSubmit={invite}>
                <Label htmlFor={`organizer-invite-${organizerProfileId}`}>
                  {translate(locale, "organizerTeam.invite")}
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={`organizer-invite-${organizerProfileId}`}
                    name="email"
                    required
                    type="email"
                  />
                  <Button disabled={busy !== null} type="submit" variant="outline">
                    {translate(locale, "organizerTeam.send")}
                  </Button>
                </div>
              </form>
              {team.pendingInvites.length > 0 ? (
                <ul className="m-0 grid list-none divide-y border-y p-0">
                  {team.pendingInvites.map((inviteItem) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                      key={inviteItem.id}
                    >
                      <div className="grid min-w-0 gap-0.5">
                        <strong className="break-all">{inviteItem.email}</strong>
                        <span className="text-sm text-muted-foreground">
                          {translate(locale, "team.expires")}{" "}
                          {formatDateTime(locale, inviteItem.expiresAt, "Europe/Stockholm")}
                        </span>
                      </div>
                      <Button
                        disabled={busy !== null}
                        onClick={() => void cancelInvite(inviteItem.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {translate(locale, "team.cancelInvite")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      )}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {team ? status : ""}
      </p>
    </div>
  );
}
