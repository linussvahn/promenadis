import type { OrganizerProfileSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { useAccountData } from "../lib/use-account-data";
import { AccountDeletion } from "./account-deletion";
import { AccountShell } from "./account-shell";
import { NotificationPreferences } from "./notification-preferences";
import { OrganizerProfileEditor } from "./organizer-profile-editor";
import { OrganizerTeam } from "./organizer-team";
import { OrganizerVerification } from "./organizer-verification";
import { backLink, PageHeading, PageMain } from "./page";
import { RecoveryCode } from "./recovery-code";
import { TwoStep } from "./two-step";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

type Client = {
  readonly api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
  readonly token: string;
};
type OrganizerType = "individual" | "informal_group" | "association" | "company";

export function Settings() {
  return <AccountShell>{({ locale }) => <SettingsContent locale={locale} />}</AccountShell>;
}

function SettingsContent({ locale }: { readonly locale: Locale }) {
  const { accessToken, dashboard, deletionPending, loadDashboard, loadFailed, setDashboard } =
    useAccountData();
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const personalOrganizer = dashboard?.organizers.find(
    (organizer) => organizer.organizerType === "individual",
  );

  // Keyed on the stored value, not the dashboard object: a background reload
  // must not wipe what the user is typing.
  const storedDisplayName = dashboard ? (dashboard.profile.displayName ?? "") : null;
  useEffect(() => {
    if (storedDisplayName !== null) setDisplayName(storedDisplayName);
  }, [storedDisplayName]);

  const profileMutation = useMutation({
    mutationFn: ({ api, token, name }: Client & { name: string }) =>
      api.updateProfile(token, { displayName: name, preferredLocale: locale }),
    onSuccess: (profile) => {
      setDashboard((current) => (current ? { ...current, profile } : current));
      setStatus(translate(locale, "dashboard.saved"));
    },
    onError: () => setStatus(translate(locale, "dashboard.error")),
  });

  const organizerMutation = useMutation({
    mutationFn: ({ api, token, form }: Client & { form: FormData; formElement: HTMLFormElement }) =>
      api.createOrganizer(token, {
        displayName: String(form.get("displayName") ?? ""),
        locality: String(form.get("locality") ?? ""),
        organizerType: String(form.get("organizerType") ?? "informal_group") as OrganizerType,
        website: String(form.get("website") ?? ""),
      }),
    onSuccess: async (_organizer, { formElement }) => {
      formElement.reset();
      await loadDashboard();
      setStatus(translate(locale, "dashboard.created"));
    },
    onError: () => setStatus(translate(locale, "dashboard.error")),
  });

  const busy = profileMutation.isPending || organizerMutation.isPending;

  const call = async (): Promise<Client | null> => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    return api && token ? { api, token } : null;
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const client = await call();
    if (!client) return;
    setStatus("");
    profileMutation.mutate({ ...client, name: displayName });
  };

  const createOrganizer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const client = await call();
    if (!client) return;
    const form = new FormData(formElement);
    setStatus("");
    organizerMutation.mutate({ ...client, form, formElement });
  };

  return (
    <PageMain>
      <Link className={backLink} to="/dashboard">
        ← {translate(locale, "event.backToEvents")}
      </Link>
      <PageHeading
        description={translate(locale, "settings.intro")}
        eyebrow="Promenadis"
        title={translate(locale, "settings.title")}
      />

      {deletionPending ? (
        <AccountDeletion accessToken={accessToken} locale={locale} onCancelled={loadDashboard} />
      ) : loadFailed ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{translate(locale, "dashboard.sessionExpired")}</AlertDescription>
        </Alert>
      ) : !dashboard ? (
        <p aria-live="polite">{translate(locale, "common.loading")}</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card asChild>
            <section aria-labelledby="profile-heading">
              <CardHeader>
                <CardTitle id="profile-heading">{translate(locale, "dashboard.profile")}</CardTitle>
                <CardDescription>{translate(locale, "settings.profileHelp")}</CardDescription>
              </CardHeader>
              <CardContent className="gap-6">
                <form className="grid max-w-md gap-4" onSubmit={saveProfile}>
                  <Field>
                    <Label htmlFor="profile-display-name">
                      {translate(locale, "dashboard.displayName")}
                    </Label>
                    <Input
                      id="profile-display-name"
                      maxLength={80}
                      name="displayName"
                      onChange={(event) => setDisplayName(event.currentTarget.value)}
                      value={displayName}
                    />
                  </Field>
                  <div>
                    <Button disabled={busy} type="submit">
                      {translate(locale, "dashboard.saveProfile")}
                    </Button>
                  </div>
                </form>
                <div className="grid gap-3 border-t pt-6">
                  <h3 className="text-base font-bold">
                    {translate(locale, "settings.personalOrganizerTitle")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {translate(locale, "settings.personalOrganizerHelp")}
                  </p>
                  {personalOrganizer ? (
                    <>
                      <strong>{personalOrganizer.displayName}</strong>
                      <OrganizerProfileEditor
                        accessToken={accessToken}
                        locale={locale}
                        onSaved={loadDashboard}
                        organizer={personalOrganizer}
                      />
                    </>
                  ) : (
                    <form className="grid max-w-md gap-4" onSubmit={createOrganizer}>
                      <input name="organizerType" type="hidden" value="individual" />
                      <input name="locality" type="hidden" value="" />
                      <input name="website" type="hidden" value="" />
                      <Field>
                        <Label htmlFor="personal-organizer-name">
                          {translate(locale, "dashboard.publicOrganizerName")}
                        </Label>
                        <Input
                          id="personal-organizer-name"
                          maxLength={100}
                          name="displayName"
                          required
                        />
                      </Field>
                      <div>
                        <Button disabled={busy} type="submit" variant="outline">
                          {translate(locale, "settings.createPersonalOrganizer")}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </CardContent>
            </section>
          </Card>

          <Card asChild>
            <section aria-labelledby="organizers-heading">
              <CardHeader>
                <CardTitle id="organizers-heading">
                  {translate(locale, "settings.organizersTitle")}
                </CardTitle>
                <CardDescription>
                  {translate(locale, "dashboard.additionalOrganizersHelp")}
                </CardDescription>
              </CardHeader>
              <CardContent className="gap-6">
                <OrganizerList
                  accessToken={accessToken}
                  locale={locale}
                  onSaved={loadDashboard}
                  organizers={dashboard.organizers.filter(
                    (organizer) => organizer.organizerType !== "individual",
                  )}
                />
                <details className="group rounded-xl border border-dashed bg-muted/40 px-4 py-1">
                  <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 font-semibold text-link [&::-webkit-details-marker]:hidden">
                    <PlusIcon
                      aria-hidden="true"
                      className="size-4 transition-transform group-open:rotate-45"
                    />
                    {translate(locale, "dashboard.newOrganizer")}
                  </summary>
                  <form className="grid max-w-md gap-4 pt-2 pb-4" onSubmit={createOrganizer}>
                    <Field>
                      <Label htmlFor="organizer-name">
                        {translate(locale, "dashboard.organizerName")}
                      </Label>
                      <Input id="organizer-name" maxLength={100} name="displayName" required />
                    </Field>
                    <Field>
                      <Label htmlFor="organizer-type">
                        {translate(locale, "dashboard.organizerType")}
                      </Label>
                      <NativeSelect
                        defaultValue="informal_group"
                        id="organizer-type"
                        name="organizerType"
                      >
                        {(["informal_group", "association", "company"] as const).map((value) => (
                          <NativeSelectOption key={value} value={value}>
                            {translate(locale, `organizerType.${value}`)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <Label htmlFor="organizer-locality">
                        {translate(locale, "dashboard.locality")}
                      </Label>
                      <Input id="organizer-locality" maxLength={100} name="locality" />
                    </Field>
                    <Field>
                      <Label htmlFor="organizer-website">
                        {translate(locale, "dashboard.website")}
                      </Label>
                      <Input
                        id="organizer-website"
                        maxLength={500}
                        name="website"
                        placeholder="https://"
                        type="url"
                      />
                    </Field>
                    <div>
                      <Button disabled={busy} type="submit">
                        {translate(locale, "dashboard.createOrganizer")}
                      </Button>
                    </div>
                  </form>
                </details>
              </CardContent>
            </section>
          </Card>
          <RecoveryCode accessToken={accessToken} locale={locale} />
          <NotificationPreferences accessToken={accessToken} locale={locale} />
          <TwoStep accessToken={accessToken} locale={locale} />
          <AccountDeletion accessToken={accessToken} locale={locale} onCancelled={loadDashboard} />
        </div>
      )}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status}
      </p>
    </PageMain>
  );
}

function OrganizerList({
  accessToken,
  locale,
  onSaved,
  organizers,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
  readonly onSaved: () => Promise<void>;
  readonly organizers: readonly OrganizerProfileSummary[];
}) {
  if (organizers.length === 0) {
    return (
      <p className="text-muted-foreground">
        {translate(locale, "dashboard.noAdditionalOrganizers")}
      </p>
    );
  }
  return (
    <ul className="m-0 grid list-none divide-y p-0">
      {organizers.map((organizer) => (
        <li className="grid gap-4 py-6 first:pt-0" key={organizer.id}>
          <div className="grid gap-1">
            <strong className="font-display text-lg">{organizer.displayName}</strong>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">
                {translate(locale, `organizerType.${organizer.organizerType}`)}
              </Badge>
              {organizer.locality ? <span>{organizer.locality}</span> : null}
            </div>
          </div>
          <OrganizerProfileEditor
            accessToken={accessToken}
            locale={locale}
            onSaved={onSaved}
            organizer={organizer}
          />
          <OrganizerTeam
            locale={locale}
            organizerProfileId={organizer.id}
            owner={organizer.role === "owner"}
          />
          {organizer.organizerType === "association" || organizer.organizerType === "company" ? (
            <OrganizerVerification locale={locale} organizerProfileId={organizer.id} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
