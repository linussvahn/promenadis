import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { SellerInvite } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
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
  const [invites, setInvites] = useState<SellerInvite[] | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void (async () => {
      const client = await call();
      if (!client) return;
      try {
        setInvites(await client.api.listSellerInvites(client.token, eventId));
      } catch {
        setInvites(null);
      }
    })();
  }, [call, eventId]);

  const invite = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    const client = await call();
    if (!client) return;
    try {
      setInvites(await client.api.inviteSeller(client.token, eventId, email));
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
    const client = await call();
    if (!client) return;
    try {
      setInvites(await client.api.cancelSellerInvite(client.token, id));
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
