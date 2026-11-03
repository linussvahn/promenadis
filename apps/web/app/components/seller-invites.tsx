import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { SellerInvite } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { accountKey } from "../lib/use-account-data";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;

// Owner/co-host invitations by email. They never reserve a seller place.
export function SellerInvites({
  call,
  eventId,
  locale,
  timezone,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly eventId: string;
  readonly locale: Locale;
  readonly timezone: string;
}) {
  const accountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const invitesKey = accountKey(accountId, "event", eventId, "seller-invites");

  const invitesQuery = useQuery({
    queryKey: invitesKey,
    queryFn: async () => {
      const client = await call();
      return client ? client.api.listSellerInvites(client.token, eventId) : null;
    },
  });
  const invites: SellerInvite[] | null = invitesQuery.isError ? null : (invitesQuery.data ?? null);

  // Both writes answer with the event's current invite list.
  const write = useMutation({
    mutationFn: async (
      action: (client: { api: ApiClient; token: string }) => Promise<SellerInvite[]>,
    ) => {
      const client = await call();
      return client ? action(client) : null;
    },
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(invitesKey, next);
    },
  });

  const invite = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    try {
      if (!(await write.mutateAsync(({ api, token }) => api.inviteSeller(token, eventId, email)))) {
        return;
      }
      form.reset();
      setStatus(translate(locale, "sellerInvite.sent"));
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "invalid_state"
            ? "sellerInvite.closed"
            : "sellerInvite.error",
        ),
      );
    }
  };

  const cancel = async (id: string) => {
    try {
      await write.mutateAsync(({ api, token }) => api.cancelSellerInvite(token, id));
    } catch {
      setStatus(translate(locale, "sellerInvite.error"));
    }
  };

  if (!invites) return null;
  return (
    <Card asChild>
      <section aria-labelledby="seller-invite-heading">
        <CardHeader>
          <CardTitle id="seller-invite-heading">
            {translate(locale, "sellerInvite.title")}
          </CardTitle>
          <CardDescription>{translate(locale, "sellerInvite.help")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-center gap-3" onSubmit={invite}>
            <Label className="sr-only" htmlFor="seller-invite-email">
              {translate(locale, "sellerInvite.email")}
            </Label>
            <Input
              autoComplete="off"
              className="flex-1 basis-60"
              id="seller-invite-email"
              name="email"
              placeholder={translate(locale, "sellerInvite.email")}
              required
              type="email"
            />
            <Button type="submit" variant="outline">
              {translate(locale, "sellerInvite.send")}
            </Button>
          </form>
          <ul className="m-0 grid list-none divide-y p-0">
            {invites.map((item) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 last:pb-0"
                key={item.id}
              >
                <span className="min-w-0 font-semibold break-all">{item.email}</span>
                <span className="text-sm text-muted-foreground">
                  {translate(locale, "sellerInvite.expires")}{" "}
                  {formatDateTime(locale, item.expiresAt, timezone)}
                </span>
                <Button
                  className="ml-auto"
                  onClick={() => void cancel(item.id)}
                  type="button"
                  variant="link"
                >
                  {translate(locale, "sellerInvite.cancel")}
                </Button>
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
