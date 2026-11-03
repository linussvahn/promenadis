import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary, OrganizerProfileSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { toDateTimeLocal, wallTimeToIso } from "../lib/wall-time";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

// Copies description, area and visibility into a new owner-only draft with new
// dates. Team, sellers and history are never copied.
export function EventDuplicate({
  accessToken,
  event,
  locale,
  onCreated,
  organizers,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onCreated: (eventId: string) => Promise<void>;
  readonly organizers: readonly OrganizerProfileSummary[];
}) {
  const [status, setStatus] = useState("");

  // Stays pending through onCreated, which opens the copy.
  const duplication = useMutation({
    mutationFn: async (input: {
      api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
      form: FormData;
      organizerProfileId: string;
      token: string;
    }) => {
      const created = await input.api.duplicateEvent(input.token, event.id, {
        endsAt: wallTimeToIso(String(input.form.get("endsAt") ?? ""), event.timezone),
        organizerProfileId: String(
          input.form.get("organizerProfileId") ?? input.organizerProfileId,
        ),
        startsAt: wallTimeToIso(String(input.form.get("startsAt") ?? ""), event.timezone),
        title: String(input.form.get("title") ?? ""),
      });
      await onCreated(created.id);
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(locale, code === "invalid_request" ? "details.invalid" : "duplicate.error"),
      );
    },
    onMutate: () => setStatus(""),
  });
  const busy = duplication.isPending;

  if (!["owner", "co_host"].includes(event.role)) return null;

  const interval = event.intervals[0];
  const nextYear = (value: string | undefined) => {
    const date = new Date(value ?? Date.now());
    date.setFullYear(date.getFullYear() + 1);
    return toDateTimeLocal(date.toISOString(), event.timezone);
  };
  const defaultOrganizer =
    organizers.find((organizer) => organizer.id === event.organizerProfileId) ?? organizers[0];

  const duplicate = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token || !defaultOrganizer) return;
    duplication.mutate({ api, form, organizerProfileId: defaultOrganizer.id, token });
  };

  return (
    <Card asChild className="gap-0 py-0">
      <details className="[&>summary]:cursor-pointer">
        <summary className="flex min-h-11 items-center px-6 py-5 font-display text-lg font-extrabold">
          {translate(locale, "duplicate.title")}
        </summary>
        <div className="grid gap-3 border-t px-6 pt-5 pb-6">
          {defaultOrganizer ? (
            <form className="grid gap-5" onSubmit={(formEvent) => void duplicate(formEvent)}>
              <FieldDescription>{translate(locale, "duplicate.help")}</FieldDescription>
              {organizers.length > 1 ? (
                <Field>
                  <Label htmlFor="duplicate-organizer">
                    {translate(locale, "dashboard.organizingAs")}
                  </Label>
                  <NativeSelect
                    defaultValue={defaultOrganizer.id}
                    id="duplicate-organizer"
                    name="organizerProfileId"
                  >
                    {organizers.map((organizer) => (
                      <NativeSelectOption key={organizer.id} value={organizer.id}>
                        {organizer.displayName}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              <Field>
                <Label htmlFor="duplicate-title">{translate(locale, "dashboard.eventTitle")}</Label>
                <Input
                  defaultValue={event.title}
                  id="duplicate-title"
                  maxLength={120}
                  name="title"
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="duplicate-start">{translate(locale, "dashboard.startsAt")}</Label>
                  <Input
                    defaultValue={nextYear(interval?.startsAt)}
                    id="duplicate-start"
                    name="startsAt"
                    required
                    type="datetime-local"
                  />
                </Field>
                <Field>
                  <Label htmlFor="duplicate-end">{translate(locale, "dashboard.endsAt")}</Label>
                  <Input
                    defaultValue={nextYear(interval?.endsAt)}
                    id="duplicate-end"
                    name="endsAt"
                    required
                    type="datetime-local"
                  />
                </Field>
              </div>
              <Button className="justify-self-start" disabled={busy} type="submit">
                {busy ? translate(locale, "common.saving") : translate(locale, "duplicate.create")}
              </Button>
            </form>
          ) : (
            <FieldDescription>{translate(locale, "duplicate.noOrganizer")}</FieldDescription>
          )}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </div>
      </details>
    </Card>
  );
}
