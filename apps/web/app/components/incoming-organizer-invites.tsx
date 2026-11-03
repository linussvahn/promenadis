import { PromenadisApiError } from "@promenadis/api-client";
import type { IncomingOrganizerInviteSummary } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
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
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  const queryClient = useQueryClient();
  const invitesKey = accountKey(expectedAccountId, "organizer-invites");
  const invitesQuery = useQuery({
    queryKey: invitesKey,
    queryFn: async (): Promise<IncomingOrganizerInviteSummary[]> => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return [];
      return authenticated.api.getIncomingOrganizerInvites(authenticated.token);
    },
    retry: false,
  });
  const invites = invitesQuery.data ?? [];
  const shownStatus =
    status || (invitesQuery.isError ? translate(locale, "organizerTeam.incomingError") : "");

  const acceptInvite = useMutation({
    mutationFn: async ({ displayName, inviteId }: { displayName: string; inviteId: string }) => {
      const authenticated = await authenticatedClient();
      if (!authenticated) throw new Error("missing_session");
      await authenticated.api.acceptOrganizerManagerInvite(authenticated.token, inviteId, {
        displayName,
      });
      queryClient.setQueryData<IncomingOrganizerInviteSummary[]>(invitesKey, (current) =>
        current?.filter((invite) => invite.id !== inviteId),
      );
      await onAccepted();
    },
    onError: (error) => {
      setStatus(
        error instanceof PromenadisApiError && error.code === "invite_unavailable"
          ? translate(locale, "team.inviteUnavailable")
          : translate(locale, "organizerTeam.error"),
      );
    },
    onSuccess: () => setStatus(translate(locale, "organizerTeam.accepted")),
  });
  const busy = acceptInvite.isPending ? acceptInvite.variables.inviteId : null;

  const accept = (formEvent: FormEvent<HTMLFormElement>, inviteId: string) => {
    formEvent.preventDefault();
    acceptInvite.mutate({
      displayName: String(new FormData(formEvent.currentTarget).get("displayName") ?? ""),
      inviteId,
    });
  };

  if (invites.length === 0 && !shownStatus) return null;
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
                  onSubmit={(event) => accept(event, invite.id)}
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
            {shownStatus}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
