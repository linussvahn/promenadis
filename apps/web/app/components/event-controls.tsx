import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

export function EventControls({
  event,
  locale,
  onDeleted,
  onSaved,
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onDeleted: () => Promise<void>;
  readonly onSaved: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [busyAction, setBusyAction] = useState<"delete" | "visibility" | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState(event.visibility);

  useEffect(() => {
    setVisibility(event.visibility);
  }, [event.visibility]);

  if (event.state !== "draft" || !["owner", "co_host"].includes(event.role)) return null;

  const accessToken = async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  };

  const saveVisibility = async () => {
    setBusyAction("visibility");
    setStatus("");
    try {
      const authenticated = await accessToken();
      if (!authenticated) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      await authenticated.api.updateDraftEventVisibility(authenticated.token, event.id, {
        expectedVersion: event.version,
        visibility,
      });
      await onSaved();
      setStatus(translate(locale, "event.visibilitySaved"));
    } catch (error) {
      const key =
        error instanceof PromenadisApiError && error.code === "version_conflict"
          ? "event.versionConflict"
          : "dashboard.error";
      setStatus(translate(locale, key));
    } finally {
      setBusyAction(null);
    }
  };

  const deleteDraft = async () => {
    setBusyAction("delete");
    setStatus("");
    try {
      const authenticated = await accessToken();
      if (!authenticated) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      await authenticated.api.deleteDraftEvent(authenticated.token, event.id, {
        confirmTitle,
        expectedVersion: event.version,
      });
      await onDeleted();
    } catch (error) {
      const key =
        error instanceof PromenadisApiError && error.code === "recent_auth_required"
          ? "event.deleteRecentAuth"
          : error instanceof PromenadisApiError && error.code === "version_conflict"
            ? "event.versionConflict"
            : error instanceof PromenadisApiError && error.code === "confirmation_mismatch"
              ? "event.deleteConfirmationMismatch"
              : "dashboard.error";
      setStatus(translate(locale, key));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Card asChild>
      <section aria-labelledby="event-controls-heading">
        <CardHeader>
          <CardTitle id="event-controls-heading">{translate(locale, "event.controls")}</CardTitle>
          <CardDescription>{translate(locale, "event.controlsHelp")}</CardDescription>
        </CardHeader>

        <CardContent className="gap-6">
          <form
            className="grid gap-2"
            onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
              formEvent.preventDefault();
              void saveVisibility();
            }}
          >
            <Label htmlFor="event-visibility">{translate(locale, "dashboard.visibility")}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-64">
                <NativeSelect
                  disabled={busyAction !== null}
                  id="event-visibility"
                  onChange={(inputEvent) =>
                    setVisibility(inputEvent.currentTarget.value as typeof visibility)
                  }
                  value={visibility}
                >
                  <NativeSelectOption value="public">
                    {translate(locale, "visibility.public")}
                  </NativeSelectOption>
                  <NativeSelectOption value="unlisted">
                    {translate(locale, "visibility.unlisted")}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <Button
                disabled={busyAction !== null || visibility === event.visibility}
                type="submit"
                variant="outline"
              >
                {busyAction === "visibility"
                  ? translate(locale, "common.saving")
                  : translate(locale, "event.saveVisibility")}
              </Button>
            </div>
            <FieldDescription>
              {visibility === "unlisted"
                ? translate(locale, "event.unlistedHelp")
                : translate(locale, "event.publicHelp")}
            </FieldDescription>
          </form>

          {event.role === "owner" ? (
            <details className="border-t pt-5 [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:font-semibold [&>summary]:text-destructive-foreground">
              <summary>{translate(locale, "event.deleteDraft")}</summary>
              <div className="mt-3 grid max-w-xl gap-3 rounded-xl border border-destructive/40 bg-destructive-soft p-4 text-destructive-foreground">
                <p className="leading-relaxed">{translate(locale, "event.deleteHelp")}</p>
                <form
                  className="grid gap-3"
                  onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
                    formEvent.preventDefault();
                    void deleteDraft();
                  }}
                >
                  <Field>
                    <Label htmlFor="confirm-event-title">
                      {translate(locale, "event.deleteConfirmation")}
                    </Label>
                    <Input
                      autoComplete="off"
                      id="confirm-event-title"
                      onChange={(inputEvent) => setConfirmTitle(inputEvent.currentTarget.value)}
                      placeholder={event.title}
                      required
                      value={confirmTitle}
                    />
                  </Field>
                  <Button
                    className="justify-self-start"
                    disabled={busyAction !== null || confirmTitle.trim() !== event.title}
                    type="submit"
                    variant="destructive"
                  >
                    {busyAction === "delete"
                      ? translate(locale, "event.deletingDraft")
                      : translate(locale, "event.confirmDelete")}
                  </Button>
                </form>
              </div>
            </details>
          ) : null}

          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
