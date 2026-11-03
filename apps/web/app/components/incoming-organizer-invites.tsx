import { PromenadisApiError } from "@promenadis/api-client";
import type { IncomingOrganizerInviteSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
    <Card asChild className="border-sun/60">
      <section aria-labelledby="incoming-organizer-invites-heading">
        <CardHeader>
          <CardTitle id="incoming-organizer-invites-heading">
            {translate(locale, "organizerTeam.incomingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <ul className="m-0 grid list-none divide-y p-0">
            {invites.map((invite) => (
              <li
                className="flex flex-wrap items-end justify-between gap-4 py-4 first:pt-0"
                key={invite.id}
              >
                <div className="grid gap-0.5">
                  <strong>{invite.organizerDisplayName}</strong>
                  <span className="text-sm text-muted-foreground">
                    {translate(locale, "team.expires")}{" "}
                    {formatDateTime(locale, invite.expiresAt, "Europe/Stockholm")}
                  </span>
                </div>
                <form
                  className="grid w-full max-w-md gap-2"
                  onSubmit={(event) => void accept(event, invite.id)}
                >
                  <Label htmlFor={`organizer-invite-name-${invite.id}`}>
                    {translate(locale, "organizerTeam.displayName")}
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      defaultValue={displayName}
                      id={`organizer-invite-name-${invite.id}`}
                      maxLength={80}
                      name="displayName"
                      required
                    />
                    <Button disabled={busy !== null} type="submit">
                      {translate(locale, "organizerTeam.accept")}
                    </Button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
