import { PromenadisApiError } from "@promenadis/api-client";
import type { IncomingEventTeamInviteSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
    <Card asChild className="border-sun/60">
      <section aria-labelledby="incoming-team-invites-heading">
        <CardHeader>
          <CardTitle id="incoming-team-invites-heading">
            {translate(locale, "team.incomingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          {invites.length > 0 ? (
            <ul className="m-0 grid list-none divide-y p-0">
              {invites.map((invite) => (
                <li
                  className="flex flex-wrap items-end justify-between gap-4 py-4 first:pt-0"
                  key={invite.id}
                >
                  <div className="grid gap-0.5">
                    <strong>{invite.eventTitle}</strong>
                    <span className="text-sm text-muted-foreground">
                      {invite.organizerDisplayName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {translate(locale, `team.role.${invite.role}`)} ·{" "}
                      {translate(locale, "team.expires")}{" "}
                      {formatDateTime(locale, invite.expiresAt, "Europe/Stockholm")}
                    </span>
                  </div>
                  <form
                    className="grid w-full max-w-md gap-2"
                    onSubmit={(formEvent) => void accept(formEvent, invite.id)}
                  >
                    <Label htmlFor={`invite-display-name-${invite.id}`}>
                      {translate(locale, "team.acceptDisplayName")}
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        defaultValue={displayName}
                        disabled={busy !== null}
                        id={`invite-display-name-${invite.id}`}
                        name="displayName"
                        required
                      />
                      <Button disabled={busy !== null} type="submit">
                        {busy === invite.id
                          ? translate(locale, "team.accepting")
                          : translate(locale, "team.accept")}
                      </Button>
                    </div>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
