import { translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountShell } from "./account-shell";
import { CreationProgress } from "./creation-progress";
import { backLink, PageHeading, PageMain } from "./page";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Field, FieldDescription, FieldGroup } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Stockholm";
}

function toLocalDateTimeInput(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function defaultSchedule(): { readonly endsAt: string; readonly startsAt: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(15, 0, 0, 0);
  return { endsAt: toLocalDateTimeInput(end), startsAt: toLocalDateTimeInput(start) };
}

export function NewEvent() {
  return <AccountShell>{({ locale }) => <NewEventContent locale={locale} />}</AccountShell>;
}

function NewEventContent({ locale }: { readonly locale: "sv" | "en" }) {
  const navigate = useNavigate();
  const { accessToken, dashboard, loadFailed } = useAccountData();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [scheduleDefaults, setScheduleDefaults] = useState<ReturnType<
    typeof defaultSchedule
  > | null>(null);

  useEffect(() => {
    setScheduleDefaults(defaultSchedule());
  }, []);

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dashboard) return;
    const api = getPromenadisApiClient();
    const form = new FormData(event.currentTarget);
    const token = await accessToken();
    if (!api || !token) return;
    const selectedOrganizerId =
      dashboard.organizers.length > 1
        ? String(form.get("organizerProfileId") ?? "")
        : (dashboard.organizers[0]?.id ?? null);

    setBusy(true);
    setStatus("");
    try {
      const created = await api.createDraftEvent(token, {
        description: String(form.get("description") ?? ""),
        endsAt: new Date(String(form.get("endsAt") ?? "")).toISOString(),
        organizerProfileId: selectedOrganizerId,
        publicOrganizerName:
          dashboard.organizers.length === 0 ? String(form.get("publicOrganizerName") ?? "") : "",
        startsAt: new Date(String(form.get("startsAt") ?? "")).toISOString(),
        timezone: defaultTimeZone(),
        title: String(form.get("title") ?? ""),
        visibility: String(form.get("visibility") ?? "public") as "public" | "unlisted",
      });
      await navigate(`/events/${created.id}/area?new=1`);
    } catch {
      setStatus(translate(locale, "dashboard.error"));
      setBusy(false);
    }
  };

  return (
    <PageMain width="flow">
      <Link className={backLink} to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <CreationProgress currentStep={1} locale={locale} />
      <PageHeading
        description={translate(locale, "creation.basicsIntro")}
        eyebrow={translate(locale, "creation.stepBasics")}
        title={translate(locale, "creation.basicsTitle")}
      />

      {loadFailed ? (
        <Alert role="alert" variant="destructive">
          {translate(locale, "dashboard.sessionExpired")}
        </Alert>
      ) : !dashboard || !scheduleDefaults ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : (
        <Card asChild className="gap-0 py-2">
          <form onSubmit={createEvent}>
            <CardContent className="gap-0 divide-y sm:px-8">
              {dashboard.organizers.length === 0 ? (
                <Field className={section}>
                  <p className="font-display text-lg font-extrabold">
                    {translate(locale, "dashboard.organizedByYou")}
                  </p>
                  <Label htmlFor="public-organizer-name">
                    {translate(locale, "dashboard.publicOrganizerName")}
                  </Label>
                  <Input
                    aria-describedby="public-organizer-help"
                    defaultValue={dashboard.profile.displayName ?? ""}
                    id="public-organizer-name"
                    maxLength={100}
                    name="publicOrganizerName"
                    required
                  />
                  <FieldDescription id="public-organizer-help">
                    {translate(locale, "dashboard.publicOrganizerHelp")}
                  </FieldDescription>
                </Field>
              ) : dashboard.organizers.length === 1 ? (
                <div className={section}>
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-muted px-4 py-3">
                    <span className="text-sm text-muted-foreground">
                      {translate(locale, "dashboard.organizingAs")}
                    </span>
                    <strong>{dashboard.organizers[0]?.displayName}</strong>
                  </p>
                </div>
              ) : (
                <Field className={section}>
                  <Label htmlFor="event-organizer">
                    {translate(locale, "dashboard.organizingAs")}
                  </Label>
                  <NativeSelect id="event-organizer" name="organizerProfileId" required>
                    {dashboard.organizers.map((organizer) => (
                      <NativeSelectOption key={organizer.id} value={organizer.id}>
                        {organizer.displayName}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}

              <FieldGroup className={section}>
                <Field>
                  <Label htmlFor="event-title">{translate(locale, "dashboard.eventTitle")}</Label>
                  <Input id="event-title" maxLength={120} name="title" required />
                </Field>
                <Field>
                  <Label htmlFor="event-description">
                    {translate(locale, "dashboard.eventDescription")}
                  </Label>
                  <Textarea id="event-description" maxLength={2000} name="description" rows={4} />
                </Field>
              </FieldGroup>

              <div className={section}>
                <h2 className="font-display text-xl font-extrabold">
                  {translate(locale, "creation.whenTitle")}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <Label htmlFor="event-start">{translate(locale, "dashboard.startsAt")}</Label>
                    <Input
                      defaultValue={scheduleDefaults.startsAt}
                      id="event-start"
                      name="startsAt"
                      required
                      type="datetime-local"
                    />
                  </Field>
                  <Field>
                    <Label htmlFor="event-end">{translate(locale, "dashboard.endsAt")}</Label>
                    <Input
                      defaultValue={scheduleDefaults.endsAt}
                      id="event-end"
                      name="endsAt"
                      required
                      type="datetime-local"
                    />
                  </Field>
                </div>
                <FieldDescription>
                  {translate(locale, "dashboard.timezone")}: {defaultTimeZone()}.{" "}
                  {translate(locale, "dashboard.timezoneHelp")}
                </FieldDescription>
              </div>

              <Field className={section}>
                <Label htmlFor="event-visibility">
                  {translate(locale, "dashboard.visibility")}
                </Label>
                <NativeSelect defaultValue="public" id="event-visibility" name="visibility">
                  <NativeSelectOption value="public">
                    {translate(locale, "visibility.public")}
                  </NativeSelectOption>
                  <NativeSelectOption value="unlisted">
                    {translate(locale, "visibility.unlisted")}
                  </NativeSelectOption>
                </NativeSelect>
                <FieldDescription>{translate(locale, "creation.visibilityHelp")}</FieldDescription>
              </Field>

              <div className="grid gap-3 py-6">
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button asChild variant="outline">
                    <Link to="/dashboard">{translate(locale, "common.cancel")}</Link>
                  </Button>
                  <Button disabled={busy} type="submit">
                    {busy
                      ? translate(locale, "common.saving")
                      : translate(locale, "creation.continueToArea")}
                  </Button>
                </div>
                <p aria-live="polite" className="min-h-6 text-sm font-semibold">
                  {status}
                </p>
              </div>
            </CardContent>
          </form>
        </Card>
      )}
    </PageMain>
  );
}

const section = "grid gap-3 py-6";
