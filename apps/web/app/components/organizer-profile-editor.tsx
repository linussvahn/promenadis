import { PromenadisApiError } from "@promenadis/api-client";
import type { OrganizerProfileSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

// Organizer type is fixed after creation; a rename of a verified organization
// sends its badge back for review.
export function OrganizerProfileEditor({
  accessToken,
  locale,
  onSaved,
  organizer,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
  readonly onSaved: () => Promise<void>;
  readonly organizer: OrganizerProfileSummary;
}) {
  const [status, setStatus] = useState("");
  const idPrefix = `organizer-edit-${organizer.id}`;

  // The parent's onSaved re-reads the organizer, so the form shows the new version.
  const update = useMutation({
    mutationFn: async (
      input: Parameters<
        NonNullable<ReturnType<typeof getPromenadisApiClient>>["updateOrganizer"]
      >[2],
    ) => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return false;
      await api.updateOrganizer(token, organizer.id, input);
      return true;
    },
    onSuccess: async (done) => {
      if (done) await onSaved();
    },
  });
  const busy = update.isPending;

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    setStatus("");
    try {
      const done = await update.mutateAsync({
        displayName: String(form.get("displayName") ?? ""),
        expectedVersion: organizer.version,
        locality: String(form.get("locality") ?? ""),
        website: String(form.get("website") ?? "").trim(),
      });
      if (done) setStatus(translate(locale, "organizerEdit.saved"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "version_conflict"
            ? "organizerEdit.changed"
            : code === "invalid_request"
              ? "organizerEdit.invalid"
              : "dashboard.error",
        ),
      );
    }
  };

  return (
    <details className="group rounded-xl border bg-muted/40 px-4 py-1">
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 font-semibold text-link [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        {translate(locale, "organizerEdit.title")}
      </summary>
      <form className="grid max-w-xl gap-4 pt-2 pb-4" key={organizer.version} onSubmit={save}>
        <FieldDescription>{translate(locale, "organizerEdit.help")}</FieldDescription>
        <Field>
          <Label htmlFor={`${idPrefix}-name`}>{translate(locale, "dashboard.organizerName")}</Label>
          <Input
            defaultValue={organizer.displayName}
            id={`${idPrefix}-name`}
            maxLength={100}
            name="displayName"
            required
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-locality`}>{translate(locale, "dashboard.locality")}</Label>
          <Input
            defaultValue={organizer.locality ?? ""}
            id={`${idPrefix}-locality`}
            maxLength={100}
            name="locality"
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-website`}>{translate(locale, "dashboard.website")}</Label>
          <Input
            defaultValue={organizer.website ?? ""}
            id={`${idPrefix}-website`}
            maxLength={500}
            name="website"
            placeholder="https://"
            type="url"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy} type="submit" variant="outline">
            {busy ? translate(locale, "common.saving") : translate(locale, "organizerEdit.save")}
          </Button>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </div>
      </form>
    </details>
  );
}
