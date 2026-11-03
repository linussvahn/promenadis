import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary, EventPublicLink as PublicLink } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

// The visitor link of an event. Owners can replace a leaked unlisted link;
// the old one then answers 410 Gone without redirecting.
export function EventPublicLink({
  event,
  locale,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const expectedAccountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");

  const authenticatedClient = useCallback(async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  }, [expectedAccountId]);

  // Writes elsewhere on the event (publish, edits) invalidate the event's keys,
  // which reloads the link.
  const linkKey = accountKey(expectedAccountId, "event", event.id, "publicLink");
  const linkQuery = useQuery({
    queryKey: linkKey,
    queryFn: async (): Promise<PublicLink | null> => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return null;
      return authenticated.api.getEventPublicLink(authenticated.token, event.id);
    },
  });
  const link = linkQuery.data ?? null;

  const rotation = useMutation({
    mutationFn: async (reason: string) => {
      const authenticated = await authenticatedClient();
      if (!authenticated) return null;
      return authenticated.api.rotateUnlistedLink(authenticated.token, event.id, {
        expectedEventVersion: event.version,
        ...(reason ? { safetyReason: reason } : {}),
      });
    },
    onError: (error) => {
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
    },
    onMutate: () => setStatus(""),
    onSuccess: async (rotated) => {
      if (!rotated) return;
      queryClient.setQueryData(linkKey, rotated);
      setStatus(translate(locale, "publicLink.rotated"));
      await queryClient.invalidateQueries({
        queryKey: accountKey(expectedAccountId, "dashboard"),
      });
    },
  });
  const busy = rotation.isPending;

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

  const rotate = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    rotation.mutate(String(new FormData(formEvent.currentTarget).get("safetyReason") ?? "").trim());
  };

  return (
    <Card asChild>
      <section aria-labelledby="public-link-heading">
        <CardHeader>
          <CardTitle asChild>
            <h3 id="public-link-heading">{translate(locale, "publicLink.title")}</h3>
          </CardTitle>
          {link.live ? null : (
            <CardDescription>{translate(locale, "publicLink.draft")}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 basis-64">
              <code className="block rounded-lg bg-muted px-3 py-2.5 font-mono text-sm break-all">
                {url}
              </code>
            </p>
            <Button onClick={() => void copy()} type="button" variant="outline">
              {translate(locale, "publicLink.copy")}
            </Button>
          </div>
          {link.visibility === "unlisted" ? (
            <FieldDescription>
              {translate(locale, "public.unlistedNotice")}{" "}
              {translate(locale, "publicLink.previewWarning")}
            </FieldDescription>
          ) : null}
          {canRotate ? (
            <form className="grid gap-3 rounded-xl border bg-muted/40 p-4" onSubmit={rotate}>
              <FieldDescription>{translate(locale, "publicLink.rotateIntro")}</FieldDescription>
              {link.state === "active" ? (
                <Field>
                  <Label htmlFor="rotate-safety-reason">
                    {translate(locale, "publicLink.safetyReason")}
                  </Label>
                  <Input id="rotate-safety-reason" maxLength={500} name="safetyReason" required />
                </Field>
              ) : null}
              <Button
                className="justify-self-start"
                disabled={busy}
                type="submit"
                variant="outline"
              >
                {translate(locale, "publicLink.rotate")}
              </Button>
            </form>
          ) : null}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
            {status || (linkQuery.isError ? translate(locale, "publication.error") : "")}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
