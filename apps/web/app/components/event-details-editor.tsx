import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { toDateTimeLocal, wallTimeToIso } from "../lib/wall-time";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// Title, description and schedule of a draft. Times are wall times in the
// event's own time zone, like the registration editor.
export function EventDetailsEditor({
  accessToken,
  event,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const expectedAccountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const interval = event.intervals[0];

  const details = useMutation({
    mutationFn: async ({ form, token }: { form: FormData; token: string }) => {
      const api = getPromenadisApiClient();
      if (!api) return null;
      const result = await api.updateDraftEventDetails(token, event.id, {
        description: String(form.get("description") ?? ""),
        endsAt: wallTimeToIso(String(form.get("endsAt") ?? ""), event.timezone),
        expectedVersion: event.version,
        startsAt: wallTimeToIso(String(form.get("startsAt") ?? ""), event.timezone),
        timezone: event.timezone,
        title: String(form.get("title") ?? ""),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKey(expectedAccountId, "dashboard") }),
        queryClient.invalidateQueries({
          queryKey: accountKey(expectedAccountId, "event", event.id),
        }),
      ]);
      return result;
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "version_conflict"
            ? "event.versionConflict"
            : code === "invalid_request"
              ? "details.invalid"
              : "dashboard.error",
        ),
      );
    },
    onMutate: () => setStatus(""),
    onSuccess: (result) => {
      if (!result) return;
      setStatus(
        translate(locale, result.registrationReset ? "details.registrationReset" : "details.saved"),
      );
    },
  });
  const busy = details.isPending;

  if (event.state !== "draft" || !["owner", "co_host"].includes(event.role) || !interval) {
    return null;
  }

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    details.mutate({ form, token });
  };

  return (
    <Card asChild className="py-0">
      <details className="[&>summary]:cursor-pointer">
        <summary className="flex min-h-11 items-center px-6 py-5 font-display text-lg font-extrabold">
          {translate(locale, "details.title")}
        </summary>
        <form
          className="grid gap-5 border-t px-6 pt-5 pb-6"
          key={event.version}
          onSubmit={(formEvent) => void save(formEvent)}
        >
          <FieldDescription>{translate(locale, "details.help")}</FieldDescription>
          <Field>
            <Label htmlFor="details-title">{translate(locale, "dashboard.eventTitle")}</Label>
            <Input
              defaultValue={event.title}
              id="details-title"
              maxLength={120}
              name="title"
              required
            />
          </Field>
          <Field>
            <Label htmlFor="details-description">
              {translate(locale, "dashboard.eventDescription")}
            </Label>
            <Textarea
              defaultValue={event.description}
              id="details-description"
              maxLength={2000}
              name="description"
              rows={4}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="details-start">{translate(locale, "dashboard.startsAt")}</Label>
              <Input
                defaultValue={toDateTimeLocal(interval.startsAt, event.timezone)}
                id="details-start"
                name="startsAt"
                required
                type="datetime-local"
              />
            </Field>
            <Field>
              <Label htmlFor="details-end">{translate(locale, "dashboard.endsAt")}</Label>
              <Input
                defaultValue={toDateTimeLocal(interval.endsAt, event.timezone)}
                id="details-end"
                name="endsAt"
                required
                type="datetime-local"
              />
            </Field>
          </div>
          <FieldDescription>
            {translate(locale, "dashboard.timezone")}: {event.timezone}
          </FieldDescription>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} type="submit">
              {busy ? translate(locale, "common.saving") : translate(locale, "details.save")}
            </Button>
            <p aria-live="polite" className="min-h-6 text-sm font-semibold">
              {status}
            </p>
          </div>
        </form>
      </details>
    </Card>
  );
}
