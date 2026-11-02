import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { EventTaxonomy } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;

// Owner/co-host choose which canonical categories this event offers, their
// order and up to twelve suggested tags. Categories are pinned at publication.
export function EventTaxonomyEditor({
  call,
  editable,
  eventId,
  locale,
}: {
  readonly call: () => Promise<{ api: ApiClient; token: string } | null>;
  readonly editable: boolean;
  readonly eventId: string;
  readonly locale: Locale;
}) {
  const [taxonomy, setTaxonomy] = useState<EventTaxonomy | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const apply = useCallback((next: EventTaxonomy) => {
    setTaxonomy(next);
    setOrder(next.categories.map((category) => category.id));
    setEnabled(new Set(next.categories.filter((category) => category.enabled).map((c) => c.id)));
  }, []);

  useEffect(() => {
    void (async () => {
      const client = await call();
      if (!client) return;
      try {
        apply(await client.api.getEventTaxonomy(client.token, eventId));
      } catch {
        setStatus(translate(locale, "taxonomy.error"));
      }
    })();
  }, [apply, call, eventId, locale]);

  if (!taxonomy) return null;

  const move = (index: number, delta: number) =>
    setOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(index + delta, 0, moved);
      return next;
    });

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const suggestions = String(new FormData(formEvent.currentTarget).get("suggestedTags") ?? "")
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      apply(
        await client.api.saveEventTaxonomy(client.token, eventId, {
          enabledCategoryIds: order.filter((id) => enabled.has(id)),
          expectedVersion: taxonomy.version,
          suggestedTags: suggestions,
        }),
      );
      setStatus(translate(locale, "taxonomy.saved"));
    } catch (error) {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "version_conflict"
            ? "sellers.changed"
            : code === "invalid_request"
              ? "taxonomy.invalid"
              : "taxonomy.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const byId = new Map(taxonomy.categories.map((category) => [category.id, category]));

  return (
    <details className="panel settings-details">
      <summary>{translate(locale, "taxonomy.title")}</summary>
      <form className="form-panel" key={taxonomy.version} onSubmit={save}>
        <p className="field-help">
          {translate(locale, editable ? "taxonomy.help" : "taxonomy.pinned")}
        </p>
        <ol className="category-order">
          {order.map((id, index) => {
            const category = byId.get(id);
            if (!category) return null;
            return (
              <li key={id}>
                <label className="checkbox-field">
                  <input
                    checked={enabled.has(id)}
                    disabled={!editable}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setEnabled((current) => {
                        const next = new Set(current);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                  <span>{category.label[locale]}</span>
                </label>
                {editable ? (
                  <>
                    <button
                      aria-label={`${translate(locale, "boundary.moveUp")}: ${category.label[locale]}`}
                      className="text-button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`${translate(locale, "boundary.moveDown")}: ${category.label[locale]}`}
                      className="text-button"
                      disabled={index === order.length - 1}
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      ↓
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ol>
        <label htmlFor="suggested-tags">{translate(locale, "taxonomy.suggestedTags")}</label>
        <textarea
          defaultValue={taxonomy.suggestedTags.join("\n")}
          disabled={!editable}
          id="suggested-tags"
          name="suggestedTags"
          rows={4}
        />
        {editable ? (
          <button className="secondary-button" disabled={busy} type="submit">
            {translate(locale, "taxonomy.save")}
          </button>
        ) : null}
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </form>
    </details>
  );
}
