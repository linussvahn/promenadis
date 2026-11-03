import { PromenadisApiError } from "@promenadis/api-client";
import type { AccountRecoveryClaim } from "@promenadis/contracts";
import { formatDateTime, translate } from "@promenadis/i18n";
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
  const [claim, setClaim] = useState<AccountRecoveryClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [link, setLink] = useState<{ claimId: string; verificationToken: string } | null>(null);
  const [completion, setCompletion] = useState<"completed" | "finishing" | null>(null);
  const [checking, setChecking] = useState(false);
  const [factor, setFactor] = useState<"recoveryCode" | "totp">("recoveryCode");

  useEffect(() => {
    // Fragments never reach the server. Keep the secret only in component memory.
    const readLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const claimId = fragment.get("claim");
      const verificationToken = fragment.get("token");
      if (claimId && verificationToken) {
        setLink({ claimId, verificationToken });
        setClaim(null);
        setCompletion(null);
        setStatus("");
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);

  useEffect(() => {
    // A reopened link for an already verified request goes straight to the
    // wait or finish step. Reading never verifies or consumes the code.
    const api = getPromenadisApiClient();
    if (!api || !link) return;
    let current = true;
    setChecking(true);
    api
      .readAccountRecoveryClaim(link.claimId, { verificationToken: link.verificationToken })
      .then((summary) => {
        if (current && summary.emailVerified) setClaim(summary);
      })
      .catch(() => {
        if (current) setStatus(translate(locale, "accountRecovery.unavailable"));
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [link, locale]);

  const confirm = async () => {
    const api = getPromenadisApiClient();
    if (!api || !link) return;
    setBusy(true);
    setStatus("");
    try {
      setClaim(
        await api.confirmAccountRecoveryEmail(link.claimId, {
          verificationToken: link.verificationToken,
        }),
      );
      setStatus(translate(locale, "accountRecovery.verified"));
    } catch {
      setStatus(translate(locale, "accountRecovery.unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    const api = getPromenadisApiClient();
    if (!api || !link) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await api.completeAccountRecovery(link.claimId, {
        verificationToken: link.verificationToken,
      });
      setCompletion(result.state);
      if (result.state === "completed") setLink(null);
      setStatus(
        translate(
          locale,
          result.state === "completed" ? "accountRecovery.completed" : "accountRecovery.finishing",
        ),
      );
    } catch {
      setStatus(translate(locale, "accountRecovery.completeUnavailable"));
    } finally {
      setBusy(false);
    }
  };

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const api = getPromenadisApiClient();
    if (!api) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setStatus("");
    try {
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
      form.reset();
      setStatus(translate(locale, "accountRecovery.sentLocal"));
    } catch (error) {
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
    } finally {
      setBusy(false);
    }
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
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => void complete()}
                  type="button"
                >
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
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => void confirm()}
                  type="button"
                >
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
          {status}
        </p>
      </PageMain>
    </SiteFrame>
  );
}
