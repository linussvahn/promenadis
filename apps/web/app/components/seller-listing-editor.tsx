import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type {
  EventTaxonomy,
  SaveSellerListingRequest,
  SellerListing,
  SellerParticipation,
} from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toDateTimeLocal, wallTimeToIso } from "../lib/wall-time";

type ApiClient = ReturnType<typeof createPromenadisApiClient>;
type Call = () => Promise<{ api: ApiClient; token: string } | null>;
type ItemDraft = SaveSellerListingRequest["items"][number] & { readonly key: string };
type SlotDraft = { readonly endsAt: string; readonly key: string; readonly startsAt: string };

const errorKeys = {
  closed_for_day: "listing.closedForDay",
  invalid_availability: "listing.invalidAvailability",
  invalid_request: "listing.invalid",
  other_needs_description: "listing.otherNeedsDescription",
  version_conflict: "listing.changed",
} as const;

const triStateValue = (value: boolean | null) => (value === null ? "" : value ? "yes" : "no");
const triStateFrom = (value: FormDataEntryValue | null) =>
  value === "yes" ? true : value === "no" ? false : null;

export function categoryLabel(taxonomy: EventTaxonomy, id: string, locale: Locale) {
  return taxonomy.categories.find((category) => category.id === id)?.label[locale] ?? "";
}

// The seller's text-only listing plus live status during the event.
export function SellerListingEditor({
  call,
  eventActive,
  eventEndsAt,
  eventId,
  eventStartsAt,
  locale,
  participation,
  timezone,
}: {
  readonly call: Call;
  readonly eventActive: boolean;
  readonly eventEndsAt: string | null;
  readonly eventId: string;
  readonly eventStartsAt: string | null;
  readonly locale: Locale;
  readonly participation: SellerParticipation;
  readonly timezone: string;
}) {
  const [taxonomy, setTaxonomy] = useState<EventTaxonomy | null>(null);
  const [listing, setListing] = useState<SellerListing | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const applyListing = useCallback(
    (next: SellerListing) => {
      setListing(next);
      setItems(
        next.items.map(({ categoryId, id, name, priceMinor, status: itemStatus }) => ({
          categoryId,
          key: id,
          name,
          priceMinor,
          status: itemStatus,
        })),
      );
      setSlots(
        next.availability.map((slot) => ({
          endsAt: toDateTimeLocal(slot.endsAt, timezone),
          key: crypto.randomUUID(),
          startsAt: toDateTimeLocal(slot.startsAt, timezone),
        })),
      );
      setTags(next.tags.join(", "));
    },
    [timezone],
  );

  useEffect(() => {
    void (async () => {
      const client = await call();
      if (!client) return;
      try {
        const [nextTaxonomy, nextListing] = await Promise.all([
          client.api.getEventTaxonomy(client.token, eventId),
          client.api.getSellerListing(client.token, participation.id),
        ]);
        setTaxonomy(nextTaxonomy);
        applyListing(nextListing);
      } catch {
        setStatus(translate(locale, "listing.loadFailed"));
      }
    })();
  }, [applyListing, call, eventId, locale, participation.id]);

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : "";
    return translate(locale, errorKeys[code as keyof typeof errorKeys] ?? "listing.error");
  };

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!listing) return;
    const form = new FormData(formEvent.currentTarget);
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      const saved = await client.api.saveSellerListing(client.token, participation.id, {
        accessibility: {
          elevator: triStateFrom(form.get("elevator")),
          setting: (String(form.get("setting") ?? "") ||
            null) as SellerListing["accessibility"]["setting"],
          stairs: triStateFrom(form.get("stairs")),
          stepFree: triStateFrom(form.get("stepFree")),
          strollerFriendly: triStateFrom(form.get("strollerFriendly")),
        },
        availability: slots.map((slot) => ({
          endsAt: wallTimeToIso(slot.endsAt, timezone),
          startsAt: wallTimeToIso(slot.startsAt, timezone),
        })),
        categoryIds: form.getAll("categoryIds").map(String),
        description: String(form.get("description") ?? ""),
        earlyVisibilityOptOut: form.get("earlyOptOut") === "on",
        expectedVersion: listing.version,
        items: items.map(({ categoryId, name, priceMinor, status: itemStatus }) => ({
          categoryId,
          name,
          priceMinor,
          status: itemStatus,
        })),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        title: String(form.get("title") ?? "").trim(),
      });
      applyListing(saved);
      setStatus(translate(locale, "listing.saved"));
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const setLive = async (next: "open" | "away" | "closed_early") => {
    const client = await call();
    if (!client) return;
    setBusy(true);
    setStatus("");
    try {
      applyListing(
        await client.api.setSellerLiveStatus(client.token, participation.id, {
          status: next,
          until: null,
        }),
      );
      setStatus(translate(locale, `live.${next}`));
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!taxonomy || !listing) {
    return <p aria-live="polite">{status || translate(locale, "common.loading")}</p>;
  }

  const enabled = taxonomy.categories.filter((category) => category.enabled);
  const defaultCategory = enabled[0]?.id ?? "";
  const toDefaultSlot = (value: string | null) => (value ? toDateTimeLocal(value, timezone) : "");

  return (
    <div className="seller-listing">
      {eventActive && participation.state === "approved" ? (
        <section aria-labelledby="live-heading" className="panel">
          <h2 id="live-heading">{translate(locale, "live.title")}</h2>
          <p>
            {listing.liveStatus
              ? translate(locale, `live.${listing.liveStatus.status}`)
              : translate(locale, "live.scheduled")}
          </p>
          <div className="form-actions">
            {(["open", "away", "closed_early"] as const).map((next) => (
              <button
                className={next === "closed_early" ? "danger-button" : "secondary-button"}
                disabled={busy || listing.liveStatus?.status === "closed_early"}
                key={next}
                onClick={() => void setLive(next)}
                type="button"
              >
                {translate(locale, `live.set.${next}`)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <form className="panel form-panel" key={listing.version} onSubmit={save}>
        <h2>{translate(locale, "listing.title")}</h2>
        <p className="field-help">{translate(locale, "listing.help")}</p>
        <label htmlFor="listing-title">{translate(locale, "listing.stopTitle")}</label>
        <input defaultValue={listing.title ?? ""} id="listing-title" maxLength={80} name="title" />
        <label htmlFor="listing-description">{translate(locale, "listing.description")}</label>
        <textarea
          defaultValue={listing.description}
          id="listing-description"
          maxLength={1000}
          name="description"
          rows={4}
        />
        <fieldset className="choice-group">
          <legend>{translate(locale, "listing.categories")}</legend>
          {enabled.map((category) => (
            <label className="checkbox-field" key={category.id}>
              <input
                defaultChecked={listing.categoryIds.includes(category.id)}
                name="categoryIds"
                type="checkbox"
                value={category.id}
              />
              <span>{category.label[locale]}</span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="listing-tags">{translate(locale, "listing.tags")}</label>
        <input
          aria-describedby="listing-tags-help"
          id="listing-tags"
          onChange={(event) => setTags(event.currentTarget.value)}
          value={tags}
        />
        <p className="field-help" id="listing-tags-help">
          {translate(locale, "listing.tagsHelp")}
        </p>
        {taxonomy.suggestedTags.length ? (
          <div className="form-actions">
            {taxonomy.suggestedTags.map((tag) => (
              <button
                className="secondary-button"
                key={tag}
                onClick={() => setTags((current) => (current ? `${current}, ${tag}` : tag))}
                type="button"
              >
                + {tag}
              </button>
            ))}
          </div>
        ) : null}

        <fieldset className="choice-group">
          <legend>{translate(locale, "listing.accessibility")}</legend>
          {(
            [
              ["stepFree", listing.accessibility.stepFree],
              ["stairs", listing.accessibility.stairs],
              ["elevator", listing.accessibility.elevator],
              ["strollerFriendly", listing.accessibility.strollerFriendly],
            ] as const
          ).map(([name, value]) => (
            <div key={name}>
              <label htmlFor={`listing-${name}`}>{translate(locale, `listing.fact.${name}`)}</label>
              <select defaultValue={triStateValue(value)} id={`listing-${name}`} name={name}>
                <option value="">{translate(locale, "listing.unknown")}</option>
                <option value="yes">{translate(locale, "listing.yes")}</option>
                <option value="no">{translate(locale, "listing.no")}</option>
              </select>
            </div>
          ))}
          <label htmlFor="listing-setting">{translate(locale, "listing.setting")}</label>
          <select
            defaultValue={listing.accessibility.setting ?? ""}
            id="listing-setting"
            name="setting"
          >
            <option value="">{translate(locale, "listing.unknown")}</option>
            <option value="indoor">{translate(locale, "listing.indoor")}</option>
            <option value="outdoor">{translate(locale, "listing.outdoor")}</option>
            <option value="both">{translate(locale, "listing.both")}</option>
          </select>
        </fieldset>

        <fieldset className="choice-group">
          <legend>{translate(locale, "listing.items")}</legend>
          <p className="field-help">{translate(locale, "listing.itemsHelp")}</p>
          {items.map((item, index) => (
            <div className="item-row" key={item.key}>
              <label htmlFor={`item-name-${item.key}`}>
                {translate(locale, "listing.itemName")} {index + 1}
              </label>
              <input
                id={`item-name-${item.key}`}
                maxLength={80}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setItems((current) =>
                    current.map((row) => (row.key === item.key ? { ...row, name } : row)),
                  );
                }}
                required
                value={item.name}
              />
              <label htmlFor={`item-category-${item.key}`}>
                {translate(locale, "listing.itemCategory")}
              </label>
              <select
                id={`item-category-${item.key}`}
                onChange={(event) => {
                  const categoryId = event.currentTarget.value;
                  setItems((current) =>
                    current.map((row) => (row.key === item.key ? { ...row, categoryId } : row)),
                  );
                }}
                value={item.categoryId}
              >
                {enabled.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label[locale]}
                  </option>
                ))}
              </select>
              <label htmlFor={`item-price-${item.key}`}>
                {translate(locale, "listing.itemPrice")}
              </label>
              <input
                id={`item-price-${item.key}`}
                inputMode="numeric"
                onChange={(event) => {
                  const text = event.currentTarget.value.trim();
                  const kronor = Number(text.replace(",", "."));
                  const priceMinor =
                    text && Number.isFinite(kronor) ? Math.round(kronor * 100) : null;
                  setItems((current) =>
                    current.map((row) => (row.key === item.key ? { ...row, priceMinor } : row)),
                  );
                }}
                defaultValue={item.priceMinor === null ? "" : String(item.priceMinor / 100)}
              />
              <label className="checkbox-field">
                <input
                  checked={item.status === "sold"}
                  onChange={(event) => {
                    const sold = event.currentTarget.checked;
                    setItems((current) =>
                      current.map((row) =>
                        row.key === item.key
                          ? { ...row, status: sold ? "sold" : "available" }
                          : row,
                      ),
                    );
                  }}
                  type="checkbox"
                />
                <span>{translate(locale, "listing.sold")}</span>
              </label>
              <button
                className="text-button"
                onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                type="button"
              >
                {translate(locale, "listing.remove")}
              </button>
            </div>
          ))}
          {items.length < 20 && defaultCategory ? (
            <button
              className="secondary-button"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  {
                    categoryId: defaultCategory,
                    key: crypto.randomUUID(),
                    name: "",
                    priceMinor: null,
                    status: "available",
                  },
                ])
              }
              type="button"
            >
              {translate(locale, "listing.addItem")}
            </button>
          ) : null}
          <p className="field-help">{translate(locale, "listing.priceNotice")}</p>
        </fieldset>

        <fieldset className="choice-group">
          <legend>{translate(locale, "listing.availability")}</legend>
          <p className="field-help">{translate(locale, "listing.availabilityHelp")}</p>
          {slots.map((slot, index) => (
            <div className="schedule-fields" key={slot.key}>
              <div>
                <label htmlFor={`slot-start-${slot.key}`}>
                  {translate(locale, "dashboard.startsAt")} {index + 1}
                </label>
                <input
                  id={`slot-start-${slot.key}`}
                  onChange={(event) => {
                    const startsAt = event.currentTarget.value;
                    setSlots((current) =>
                      current.map((row) => (row.key === slot.key ? { ...row, startsAt } : row)),
                    );
                  }}
                  required
                  type="datetime-local"
                  value={slot.startsAt}
                />
              </div>
              <div>
                <label htmlFor={`slot-end-${slot.key}`}>
                  {translate(locale, "dashboard.endsAt")} {index + 1}
                </label>
                <input
                  id={`slot-end-${slot.key}`}
                  onChange={(event) => {
                    const endsAt = event.currentTarget.value;
                    setSlots((current) =>
                      current.map((row) => (row.key === slot.key ? { ...row, endsAt } : row)),
                    );
                  }}
                  required
                  type="datetime-local"
                  value={slot.endsAt}
                />
              </div>
              <button
                className="text-button"
                onClick={() => setSlots((current) => current.filter((row) => row.key !== slot.key))}
                type="button"
              >
                {translate(locale, "listing.remove")}
              </button>
            </div>
          ))}
          {slots.length < 10 ? (
            <button
              className="secondary-button"
              onClick={() =>
                setSlots((current) => [
                  ...current,
                  {
                    endsAt: toDefaultSlot(eventEndsAt),
                    key: crypto.randomUUID(),
                    startsAt: toDefaultSlot(eventStartsAt),
                  },
                ])
              }
              type="button"
            >
              {translate(locale, "listing.addAvailability")}
            </button>
          ) : null}
        </fieldset>

        <label className="checkbox-field">
          <input
            defaultChecked={listing.earlyVisibilityOptOut}
            name="earlyOptOut"
            type="checkbox"
          />
          <span>{translate(locale, "listing.earlyOptOut")}</span>
        </label>
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? translate(locale, "common.saving") : translate(locale, "listing.save")}
        </button>
        <p aria-live="polite" className="form-status">
          {status}
        </p>
      </form>
    </div>
  );
}
