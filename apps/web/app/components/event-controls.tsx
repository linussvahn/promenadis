import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
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
}: {
  readonly event: DraftEventSummary;
  readonly locale: Locale;
  readonly onDeleted: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [confirmTitle, setConfirmTitle] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState(event.visibility);

  useEffect(() => {
    setVisibility(event.visibility);
  }, [event.visibility]);

  const accessToken = async () => {
    const supabase = getBrowserAuthClient(expectedAccountId);
    const api = getPromenadisApiClient();
    if (!supabase || !api) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ? { api, token: data.session.user.id } : null;
  };

  const visibilityMutation = useMutation({
    mutationFn: async () => {
      const authenticated = await accessToken();
      if (!authenticated) return false;
      await authenticated.api.updateDraftEventVisibility(authenticated.token, event.id, {
        expectedVersion: event.version,
        visibility,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKey(expectedAccountId, "dashboard") }),
        queryClient.invalidateQueries({
          queryKey: accountKey(expectedAccountId, "event", event.id),
        }),
      ]);
      return true;
    },
    onError: (error) => {
      const key =
        error instanceof PromenadisApiError && error.code === "version_conflict"
          ? "event.versionConflict"
          : "dashboard.error";
      setStatus(translate(locale, key));
    },
    onMutate: () => setStatus(""),
    onSuccess: (saved) => {
      setStatus(translate(locale, saved ? "event.visibilitySaved" : "dashboard.sessionExpired"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const authenticated = await accessToken();
      if (!authenticated) return false;
      await authenticated.api.deleteDraftEvent(authenticated.token, event.id, {
        confirmTitle,
        expectedVersion: event.version,
      });
      await onDeleted();
      return true;
    },
    onError: (error) => {
      const key =
        error instanceof PromenadisApiError && error.code === "recent_auth_required"
          ? "event.deleteRecentAuth"
          : error instanceof PromenadisApiError && error.code === "version_conflict"
            ? "event.versionConflict"
            : error instanceof PromenadisApiError && error.code === "confirmation_mismatch"
              ? "event.deleteConfirmationMismatch"
              : "dashboard.error";
      setStatus(translate(locale, key));
    },
    onMutate: () => setStatus(""),
    onSuccess: (deleted) => {
      if (!deleted) setStatus(translate(locale, "dashboard.sessionExpired"));
    },
  });

  if (event.state !== "draft" || !["owner", "co_host"].includes(event.role)) return null;

  const busyAction = visibilityMutation.isPending
    ? "visibility"
    : deleteMutation.isPending
      ? "delete"
      : null;
  const saveVisibility = () => visibilityMutation.mutate();
  const deleteDraft = () => deleteMutation.mutate();

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
              saveVisibility();
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
                    deleteDraft();
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
