import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountRecoveryClaim } from "@promenadis/contracts";
import { formatDateTime, translate } from "@promenadis/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useStoredLocale } from "../lib/locale";
import { getPromenadisApiClient, hasLocalBackendConfiguration } from "../lib/supabase";
import { backLink, PageHeading, PageMain } from "./page";
import { SiteFrame } from "./site-frame";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Radio } from "./ui/checkbox";
import { ChoiceField, Field, FieldGroup, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function RecoverAccount() {
  const { locale, setLocale } = useStoredLocale();
  const [confirmedClaim, setConfirmedClaim] = useState<AccountRecoveryClaim | null>(null);
  const [status, setStatus] = useState("");
  const [link, setLink] = useState<{
    claimId: string;
    opened: number;
    verificationToken: string;
  } | null>(null);
  const [completion, setCompletion] = useState<"completed" | "finishing" | null>(null);
  const [factor, setFactor] = useState<"recoveryCode" | "totp">("recoveryCode");

  useEffect(() => {
    // Fragments never reach the server. Keep the secret only in component memory.
    const readLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const claimId = fragment.get("claim");
      const verificationToken = fragment.get("token");
      if (claimId && verificationToken) {
        // Each opening reads the claim afresh, even for the same link.
        setLink({ claimId, opened: Date.now(), verificationToken });
        setConfirmedClaim(null);
        setCompletion(null);
        setStatus("");
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);

  // A reopened link for an already verified request goes straight to the
  // wait or finish step. Reading never verifies or consumes the code.
  const api = getPromenadisApiClient();
  const claimQuery = useQuery({
    enabled: Boolean(api && link),
    // The token stays in memory only and is dropped as soon as the page unmounts.
    gcTime: 0,
    queryFn: () => {
      if (!api || !link) throw new Error("unavailable");
      return api.readAccountRecoveryClaim(link.claimId, {
        verificationToken: link.verificationToken,
      });
    },
    queryKey: ["account-recovery-claim", link?.claimId, link?.verificationToken, link?.opened],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const checking = claimQuery.isLoading;
  const claim = confirmedClaim ?? (claimQuery.data?.emailVerified ? claimQuery.data : null);
  const shownStatus =
    status || (claimQuery.isError ? translate(locale, "accountRecovery.unavailable") : "");

  const confirmMutation = useMutation({
    mutationFn: (current: { claimId: string; verificationToken: string }) => {
      if (!api) throw new Error("unavailable");
      return api.confirmAccountRecoveryEmail(current.claimId, {
        verificationToken: current.verificationToken,
      });
    },
    onError: () => setStatus(translate(locale, "accountRecovery.unavailable")),
    onMutate: () => setStatus(""),
    onSuccess: (summary) => {
      setConfirmedClaim(summary);
      setStatus(translate(locale, "accountRecovery.verified"));
    },
  });

  const completeMutation = useMutation({
    mutationFn: (current: { claimId: string; verificationToken: string }) => {
      if (!api) throw new Error("unavailable");
      return api.completeAccountRecovery(current.claimId, {
        verificationToken: current.verificationToken,
      });
    },
    onError: () => setStatus(translate(locale, "accountRecovery.completeUnavailable")),
    onMutate: () => setStatus(""),
    onSuccess: (result) => {
      setCompletion(result.state);
      if (result.state === "completed") setLink(null);
      setStatus(
        translate(
          locale,
          result.state === "completed" ? "accountRecovery.completed" : "accountRecovery.finishing",
        ),
      );
    },
  });

  const startMutation = useMutation({
    mutationFn: async ({ data }: { data: FormData; form: HTMLFormElement }) => {
      if (!api) throw new Error("unavailable");
      const emails = {
        currentEmail: String(data.get("currentEmail") ?? "").trim(),
        newEmail: String(data.get("newEmail") ?? "").trim(),
      };
      await api.initiateAccountRecovery(
        factor === "totp"
          ? { ...emails, totpCode: String(data.get("totpCode") ?? "").trim() }
          : {
              ...emails,
              recoveryCode: String(data.get("recoveryCode") ?? "")
                .trim()
                .toUpperCase(),
            },
      );
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : null;
      setStatus(
        translate(
          locale,
          code === "delivery_unavailable"
            ? "accountRecovery.deliveryFailed"
            : code === "rate_limited"
              ? "accountRecovery.rateLimited"
              : code === "claim_pending"
                ? "accountRecovery.pending"
                : "accountRecovery.invalid",
        ),
      );
    },
    onMutate: () => setStatus(""),
    onSuccess: (_result, { form }) => {
      form.reset();
      setStatus(translate(locale, "accountRecovery.sentLocal"));
    },
  });

  const busy = confirmMutation.isPending || completeMutation.isPending || startMutation.isPending;

  const confirm = () => {
    if (!api || !link) return;
    confirmMutation.mutate(link);
  };

  const complete = () => {
    if (!api || !link) return;
    completeMutation.mutate(link);
  };

  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!api) return;
    const form = event.currentTarget;
    startMutation.mutate({ data: new FormData(form), form });
  };

  return (
    <SiteFrame locale={locale} onLocaleChange={setLocale}>
      <PageMain className="mx-auto w-full max-w-md" width="flow">
        <a className={backLink} href="/sign-in">
          ← {translate(locale, "accountRecovery.back")}
        </a>
        <PageHeading
          description={translate(locale, "accountRecovery.intro")}
          eyebrow="Promenadis"
          title={translate(locale, "accountRecovery.title")}
        />
        <Alert>{translate(locale, "accountRecovery.preview")}</Alert>
        {!hasLocalBackendConfiguration() ? (
          <Alert role="alert" variant="destructive">
            {translate(locale, "auth.configMissing")}
          </Alert>
        ) : checking ? (
          <p className="min-h-6 text-sm font-semibold">
            {translate(locale, "accountRecovery.checking")}
          </p>
        ) : completion === "completed" ? (
          <Card asChild>
            <section>
              <CardContent>
                <Button asChild className="w-full">
                  <a href="/sign-in">{translate(locale, "accountRecovery.signIn")}</a>
                </Button>
              </CardContent>
            </section>
          </Card>
        ) : claim && link && Date.parse(claim.readyAt) <= Date.now() ? (
          <Card asChild>
            <section>
              <CardHeader>
                <CardTitle>{translate(locale, "accountRecovery.readyTitle")}</CardTitle>
                <CardDescription>
                  {translate(locale, "accountRecovery.completeHelp")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" disabled={busy} onClick={complete} type="button">
                  {translate(locale, "accountRecovery.complete")}
                </Button>
              </CardContent>
            </section>
          </Card>
        ) : claim ? (
          <Card asChild>
            <section>
              <CardHeader>
                <CardTitle>{translate(locale, "accountRecovery.waitTitle")}</CardTitle>
                <CardDescription>{translate(locale, "accountRecovery.waitHelp")}</CardDescription>
              </CardHeader>
              <CardContent className="gap-2 text-sm">
                <p>
                  {translate(locale, "accountRecovery.readyAt")}{" "}
                  {formatDateTime(locale, claim.readyAt, "Europe/Stockholm")}
                </p>
                <p>
                  {translate(locale, "accountRecovery.expiresAt")}{" "}
                  {formatDateTime(locale, claim.expiresAt, "Europe/Stockholm")}
                </p>
              </CardContent>
            </section>
          </Card>
        ) : link ? (
          <Card asChild>
            <section>
              <CardContent>
                <p>{translate(locale, "accountRecovery.confirmHelp")}</p>
                <Button className="w-full" disabled={busy} onClick={confirm} type="button">
                  {translate(locale, "accountRecovery.confirm")}
                </Button>
              </CardContent>
            </section>
          </Card>
        ) : (
          <Card asChild>
            <form onSubmit={start}>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <Label htmlFor="currentEmail">
                      {translate(locale, "accountRecovery.currentEmail")}
                    </Label>
                    <Input
                      autoComplete="email"
                      id="currentEmail"
                      name="currentEmail"
                      required
                      type="email"
                    />
                  </Field>
                  <FieldSet>
                    <FieldLegend>{translate(locale, "accountRecovery.factor")}</FieldLegend>
                    <ChoiceField>
                      <Radio
                        checked={factor === "recoveryCode"}
                        name="factor"
                        onChange={() => setFactor("recoveryCode")}
                      />
                      <span>{translate(locale, "accountRecovery.factorCode")}</span>
                    </ChoiceField>
                    <ChoiceField>
                      <Radio
                        checked={factor === "totp"}
                        name="factor"
                        onChange={() => setFactor("totp")}
                      />
                      <span>{translate(locale, "accountRecovery.factorTotp")}</span>
                    </ChoiceField>
                  </FieldSet>
                  {factor === "totp" ? (
                    <Field>
                      <Label htmlFor="totpCode">{translate(locale, "mfa.code")}</Label>
                      <Input
                        autoComplete="one-time-code"
                        id="totpCode"
                        inputMode="numeric"
                        maxLength={6}
                        minLength={6}
                        name="totpCode"
                        pattern="[0-9]{6}"
                        required
                      />
                    </Field>
                  ) : (
                    <Field>
                      <Label htmlFor="recoveryCode">
                        {translate(locale, "accountRecovery.code")}
                      </Label>
                      <Input
                        autoComplete="off"
                        id="recoveryCode"
                        name="recoveryCode"
                        maxLength={24}
                        pattern="[A-HJ-NP-Za-hj-np-z2-9]{4}(-[A-HJ-NP-Za-hj-np-z2-9]{4}){4}"
                        required
                      />
                    </Field>
                  )}
                  <Field>
                    <Label htmlFor="newEmail">
                      {translate(locale, "accountRecovery.newEmail")}
                    </Label>
                    <Input
                      autoComplete="email"
                      id="newEmail"
                      name="newEmail"
                      required
                      type="email"
                    />
                  </Field>
                </FieldGroup>
                <Button className="w-full" disabled={busy} type="submit">
                  {busy
                    ? translate(locale, "common.saving")
                    : translate(locale, "accountRecovery.start")}
                </Button>
                <a
                  className="justify-self-center font-semibold"
                  href="http://127.0.0.1:54324"
                  rel="noreferrer"
                >
                  {translate(locale, "auth.mailpit")}
                </a>
              </CardContent>
            </form>
          </Card>
        )}
        <p aria-live="polite" className="min-h-6 text-sm font-semibold">
          {shownStatus}
        </p>
      </PageMain>
    </SiteFrame>
  );
}
