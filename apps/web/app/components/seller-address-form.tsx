import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { BoundaryPoint, SellerParticipation } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, lazy, type ReactNode, Suspense, useRef, useState } from "react";

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
    <form className="form-panel creation-form" onSubmit={submit} ref={formRef}>
      {children}
      <label htmlFor={`${idPrefix}-address`}>{translate(locale, "seller.address")}</label>
      <input
        autoComplete="street-address"
        defaultValue={initial?.addressLine ?? ""}
        id={`${idPrefix}-address`}
        maxLength={200}
        minLength={3}
        name="addressLine"
        required
      />
      <div className="schedule-fields">
        <div>
          <label htmlFor={`${idPrefix}-postal-code`}>
            {translate(locale, "seller.postalCode")}
          </label>
          <input
            autoComplete="postal-code"
            defaultValue={initial?.postalCode ?? ""}
            id={`${idPrefix}-postal-code`}
            inputMode="numeric"
            maxLength={6}
            name="postalCode"
            pattern="[0-9]{3} ?[0-9]{2}"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-locality`}>{translate(locale, "seller.locality")}</label>
          <input
            autoComplete="address-level2"
            defaultValue={initial?.locality ?? ""}
            id={`${idPrefix}-locality`}
            maxLength={100}
            name="locality"
          />
        </div>
      </div>
      <p className="field-help">{translate(locale, "seller.privateAddressHelp")}</p>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => void findOnMap()}
        type="button"
      >
        {translate(locale, "seller.findOnMap")}
      </button>
      <h3>{translate(locale, "seller.pinTitle")}</h3>
      <p className="field-help">{translate(locale, "seller.pinHelp")}</p>
      <Suspense fallback={<p role="status">{translate(locale, "common.loading")}</p>}>
        <PinPicker
          boundary={eventBoundary}
          idPrefix={idPrefix}
          locale={locale}
          onChange={setPin}
          value={pin}
        />
      </Suspense>
      {sharedQuestion ? (
        <fieldset className="choice-group">
          <legend>{translate(locale, "seller.sharedQuestion")}</legend>
          <label className="checkbox-field">
            <input name="sharesEntrance" required type="radio" value="yes" />
            <span>{translate(locale, "seller.sharedYes")}</span>
          </label>
          <label className="checkbox-field">
            <input name="sharesEntrance" required type="radio" value="no" />
            <span>{translate(locale, "seller.sharedNo")}</span>
          </label>
        </fieldset>
      ) : null}
      <label className="checkbox-field">
        <input name="rightToUse" required type="checkbox" />
        <span>{translate(locale, "seller.attestation")}</span>
      </label>
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? translate(locale, "common.saving") : submitLabel}
      </button>
      <p aria-live="polite" className="form-status">
        {status}
      </p>
    </form>
  );
}
