import type { createPromenadisApiClient } from "@promenadis/api-client";
import type { AdminOperations, SupportRequests } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Call = () => Promise<{ api: ApiClient; token: string } | null>;
const switches = [
  "public_locations",
  "seller_applications",
  "organizer_relay",
  "exports",
  "support_forms",
] as const;

// Elevated-only: job health, incident switches and the support inbox.
export function AdminOperationsPanel({
  call,
  locale,
}: {
  readonly call: Call;
  readonly locale: Locale;
}) {
  const [operations, setOperations] = useState<AdminOperations | null>(null);
  const [requests, setRequests] = useState<SupportRequests>([]);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    const client = await call();
    if (!client) return;
    try {
      setOperations(await client.api.getAdminOperations(client.token));
      setRequests(await client.api.listSupportRequests(client.token));
    } catch {
      setStatus(translate(locale, "admin.elevationExpired"));
    }
  }, [call, locale]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (key: string, enabled: boolean, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const client = await call();
    if (!client) return;
    try {
      const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "");
      setOperations(await client.api.setKillSwitch(client.token, key, enabled, reason));
      setStatus(translate(locale, "operations.switchSaved"));
    } catch {
      setStatus(translate(locale, "operations.switchFailed"));
    }
  };
  const resolve = async (id: string) => {
    const client = await call();
    if (!client) return;
    setRequests(await client.api.resolveSupportRequest(client.token, id));
  };
  if (!operations) return null;
  return (
    <section aria-labelledby="operations-heading" className="panel">
      <h2 id="operations-heading">{translate(locale, "operations.title")}</h2>
      <ul>
        {(
          ["publicSnapshots", "eventLifecycle", "eventRetention", "notificationQueue"] as const
        ).map((check) => (
          <li key={check}>
            {translate(locale, `operations.check.${check}`)}:{" "}
            <strong>
              {translate(locale, operations[check] ? "operations.ok" : "operations.late")}
            </strong>
          </li>
        ))}
      </ul>
      <h3>{translate(locale, "operations.switches")}</h3>
      {switches.map((key) => {
        const on = operations.switches[key] ?? false;
        return (
          <form
            className="form-panel"
            key={key}
            onSubmit={(formEvent) => void toggle(key, !on, formEvent)}
          >
            <p>
              <strong>{translate(locale, `operations.switch.${key}`)}</strong> ·{" "}
              {translate(locale, on ? "operations.paused" : "operations.running")}
            </p>
            <label htmlFor={`switch-${key}`}>{translate(locale, "walking.reason")}</label>
            <input id={`switch-${key}`} maxLength={500} minLength={3} name="reason" required />
            <button className={on ? "secondary-button" : "danger-button"} type="submit">
              {translate(locale, on ? "operations.resume" : "operations.pause")}
            </button>
          </form>
        );
      })}
      <h3>{translate(locale, "operations.support")}</h3>
      {requests.length === 0 ? <p>{translate(locale, "operations.noSupport")}</p> : null}
      <ul className="stop-list">
        {requests.map((item) => (
          <li className="panel" key={item.id}>
            <p className="field-hint">
              {translate(locale, `support.topic.${item.topic}`)} ·{" "}
              {formatDateTime(locale, item.createdAt, "Europe/Stockholm")}
              {item.hasContact ? ` · ${translate(locale, "operations.hasContact")}` : ""}
            </p>
            <p className="relay-body">{item.body}</p>
            {item.resolvedAt ? (
              <p className="field-hint">{translate(locale, "operations.resolved")}</p>
            ) : (
              <button className="quiet-button" onClick={() => void resolve(item.id)} type="button">
                {translate(locale, "operations.resolve")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
