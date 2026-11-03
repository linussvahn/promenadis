import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { BoundaryPoint, SellerParticipation } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, lazy, type ReactNode, Suspense, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Checkbox, Radio } from "./ui/checkbox";
import { ChoiceField, Field, FieldDescription, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;

// maplibre loads only when the pin picker renders.
const PinPicker = lazy(() =>
  import("./pin-picker").then((module) => ({ default: module.PinPicker })),
);

export interface SellerAddressInput {
  readonly addressLine: string;
  readonly latitude: number;
  readonly locality: string;
  readonly longitude: number;
  readonly placement: "manual" | "geocoded";
  readonly postalCode: string;
  readonly rightToUseAttested: true;
  readonly sharesEntrance: boolean | null;
}

const errorKeys = {
  already_applied: "seller.alreadyApplied",
  area_not_ready: "seller.areaNotReady",
  invalid_state: "seller.addressLocked",
  invite_only: "seller.inviteOnly",
  rate_limited: "seller.rateLimited",
  registration_closed: "seller.closed",
  version_conflict: "seller.changed",
} as const;

// Address, proposed pin, the shared-entrance question and the attestation.
// Used for new applications and for address changes.
export function SellerAddressForm({
  call,
  children,
  eventBoundary,
  eventId,
  idPrefix,
  initial,
  locale,
  onSubmit,
  submitLabel,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly children?: ReactNode;
  readonly eventBoundary: readonly BoundaryPoint[] | null;
  readonly eventId: string;
  readonly idPrefix: string;
  readonly initial?: SellerParticipation["location"];
  readonly locale: Locale;
  readonly onSubmit: (input: SellerAddressInput, form: FormData) => Promise<void>;
  readonly submitLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pin, setPin] = useState<BoundaryPoint | null>(
    initial ? [initial.longitude, initial.latitude] : null,
  );
  const [suggested, setSuggested] = useState<BoundaryPoint | null>(null);
  const [sharedQuestion, setSharedQuestion] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const addressFields = () => {
    const form = new FormData(formRef.current ?? undefined);
    return {
      addressLine: String(form.get("addressLine") ?? "").trim(),
      locality: String(form.get("locality") ?? "").trim(),
      postalCode: String(form.get("postalCode") ?? "").trim(),
    };
  };

  const findOnMap = async () => {
    const fields = addressFields();
    if (fields.addressLine.length < 3) {
      setStatus(translate(locale, "seller.addressFirst"));
      return;
    }
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await client.api.geocodeAddress(client.token, eventId, fields);
      if (result.found && result.longitude !== null && result.latitude !== null) {
        const point: BoundaryPoint = [result.longitude, result.latitude];
        setPin(point);
        setSuggested(point);
        setStatus(translate(locale, "seller.geocodeFound"));
      } else {
        setStatus(translate(locale, "seller.geocodeMissing"));
      }
    } catch (error) {
      setStatus(
        translate(
          locale,
          error instanceof PromenadisApiError && error.code === "rate_limited"
            ? "seller.geocodeLimited"
            : "seller.geocodeMissing",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    if (!pin) {
      setStatus(translate(locale, "seller.pinRequired"));
      return;
    }
    const shared = form.get("sharesEntrance");
    setBusy(true);
    setStatus("");
    try {
      await onSubmit(
        {
          ...addressFields(),
          latitude: pin[1],
          longitude: pin[0],
          placement:
            suggested && suggested[0] === pin[0] && suggested[1] === pin[1] ? "geocoded" : "manual",
          rightToUseAttested: true,
          sharesEntrance: sharedQuestion && shared ? shared === "yes" : null,
        },
        form,
      );
      setSharedQuestion(false);
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      if (code === "shared_entrance_question") {
        setSharedQuestion(true);
        setStatus(translate(locale, "seller.sharedQuestionHelp"));
      } else {
        setStatus(translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "seller.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-5" onSubmit={submit} ref={formRef}>
      {children}
      <Field>
        <Label htmlFor={`${idPrefix}-address`}>{translate(locale, "seller.address")}</Label>
        <Input
          autoComplete="street-address"
          defaultValue={initial?.addressLine ?? ""}
          id={`${idPrefix}-address`}
          maxLength={200}
          minLength={3}
          name="addressLine"
          required
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <Field>
          <Label htmlFor={`${idPrefix}-postal-code`}>
            {translate(locale, "seller.postalCode")}
          </Label>
          <Input
            autoComplete="postal-code"
            defaultValue={initial?.postalCode ?? ""}
            id={`${idPrefix}-postal-code`}
            inputMode="numeric"
            maxLength={6}
            name="postalCode"
            pattern="[0-9]{3} ?[0-9]{2}"
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-locality`}>{translate(locale, "seller.locality")}</Label>
          <Input
            autoComplete="address-level2"
            defaultValue={initial?.locality ?? ""}
            id={`${idPrefix}-locality`}
            maxLength={100}
            name="locality"
          />
        </Field>
      </div>
      <div className="grid justify-items-start gap-3">
        <FieldDescription>{translate(locale, "seller.privateAddressHelp")}</FieldDescription>
        <Button disabled={busy} onClick={() => void findOnMap()} type="button" variant="outline">
          {translate(locale, "seller.findOnMap")}
        </Button>
      </div>
      <div className="grid gap-3 border-t pt-5">
        <div className="grid gap-1">
          <h3 className="text-lg font-bold">{translate(locale, "seller.pinTitle")}</h3>
          <FieldDescription>{translate(locale, "seller.pinHelp")}</FieldDescription>
        </div>
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground" role="status">
              {translate(locale, "common.loading")}
            </p>
          }
        >
          <PinPicker
            boundary={eventBoundary}
            idPrefix={idPrefix}
            locale={locale}
            onChange={setPin}
            value={pin}
          />
        </Suspense>
      </div>
      {sharedQuestion ? (
        <FieldSet className="rounded-xl border bg-warning-soft/60 p-4">
          <FieldLegend className="float-left mb-3 w-full">
            {translate(locale, "seller.sharedQuestion")}
          </FieldLegend>
          <ChoiceField>
            <Radio name="sharesEntrance" required value="yes" />
            <span>{translate(locale, "seller.sharedYes")}</span>
          </ChoiceField>
          <ChoiceField>
            <Radio name="sharesEntrance" required value="no" />
            <span>{translate(locale, "seller.sharedNo")}</span>
          </ChoiceField>
        </FieldSet>
      ) : null}
      <ChoiceField className="rounded-xl bg-muted/60 p-4">
        <Checkbox name="rightToUse" required />
        <span>{translate(locale, "seller.attestation")}</span>
      </ChoiceField>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} type="submit">
          {busy ? translate(locale, "common.saving") : submitLabel}
        </Button>
      </div>
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status}
      </p>
    </form>
  );
}
