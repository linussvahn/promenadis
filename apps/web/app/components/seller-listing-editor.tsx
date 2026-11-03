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
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, Field, FieldDescription, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

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

  const section = "grid gap-4 border-t pt-5";

  return (
    <div className="grid gap-6">
      {eventActive && participation.state === "approved" ? (
        <Card asChild>
          <section aria-labelledby="live-heading">
            <CardHeader>
              <CardTitle id="live-heading">{translate(locale, "live.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                <Badge variant={listing.liveStatus?.status === "open" ? "success" : "secondary"}>
                  {listing.liveStatus
                    ? translate(locale, `live.${listing.liveStatus.status}`)
                    : translate(locale, "live.scheduled")}
                </Badge>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {(["open", "away", "closed_early"] as const).map((next) => (
                  <Button
                    disabled={busy || listing.liveStatus?.status === "closed_early"}
                    key={next}
                    onClick={() => void setLive(next)}
                    type="button"
                    variant={next === "closed_early" ? "destructive" : "outline"}
                  >
                    {translate(locale, `live.set.${next}`)}
                  </Button>
                ))}
              </div>
            </CardContent>
          </section>
        </Card>
      ) : null}
      <Card asChild>
        <form key={listing.version} onSubmit={save}>
          <CardHeader>
            <CardTitle>{translate(locale, "listing.title")}</CardTitle>
            <CardDescription>{translate(locale, "listing.help")}</CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            {listing.hidden ? (
              <Alert variant="destructive">
                {translate(locale, "seller.listingHidden")} {listing.hiddenReason}
              </Alert>
            ) : null}
            <Field>
              <Label htmlFor="listing-title">{translate(locale, "listing.stopTitle")}</Label>
              <Input
                defaultValue={listing.title ?? ""}
                id="listing-title"
                maxLength={80}
                name="title"
              />
            </Field>
            <Field>
              <Label htmlFor="listing-description">
                {translate(locale, "listing.description")}
              </Label>
              <Textarea
                defaultValue={listing.description}
                id="listing-description"
                maxLength={1000}
                name="description"
                rows={4}
              />
            </Field>

            <FieldSet className={section}>
              <FieldLegend className="float-left mb-3 w-full">
                {translate(locale, "listing.categories")}
              </FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                {enabled.map((category) => (
                  <ChoiceField key={category.id}>
                    <Checkbox
                      defaultChecked={listing.categoryIds.includes(category.id)}
                      name="categoryIds"
                      value={category.id}
                    />
                    <span>{category.label[locale]}</span>
                  </ChoiceField>
                ))}
              </div>
            </FieldSet>
            <Field>
              <Label htmlFor="listing-tags">{translate(locale, "listing.tags")}</Label>
              <Input
                aria-describedby="listing-tags-help"
                id="listing-tags"
                onChange={(event) => setTags(event.currentTarget.value)}
                value={tags}
              />
              <FieldDescription id="listing-tags-help">
                {translate(locale, "listing.tagsHelp")}
              </FieldDescription>
              {taxonomy.suggestedTags.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {taxonomy.suggestedTags.map((tag) => (
                    <Button
                      key={tag}
                      onClick={() => setTags((current) => (current ? `${current}, ${tag}` : tag))}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      + {tag}
                    </Button>
                  ))}
                </div>
              ) : null}
            </Field>

            <FieldSet className={section}>
              <FieldLegend className="float-left mb-3 w-full">
                {translate(locale, "listing.accessibility")}
              </FieldLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["stepFree", listing.accessibility.stepFree],
                    ["stairs", listing.accessibility.stairs],
                    ["elevator", listing.accessibility.elevator],
                    ["strollerFriendly", listing.accessibility.strollerFriendly],
                  ] as const
                ).map(([name, value]) => (
                  <Field key={name}>
                    <Label htmlFor={`listing-${name}`}>
                      {translate(locale, `listing.fact.${name}`)}
                    </Label>
                    <NativeSelect
                      defaultValue={triStateValue(value)}
                      id={`listing-${name}`}
                      name={name}
                    >
                      <NativeSelectOption value="">
                        {translate(locale, "listing.unknown")}
                      </NativeSelectOption>
                      <NativeSelectOption value="yes">
                        {translate(locale, "listing.yes")}
                      </NativeSelectOption>
                      <NativeSelectOption value="no">
                        {translate(locale, "listing.no")}
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                ))}
                <Field>
                  <Label htmlFor="listing-setting">{translate(locale, "listing.setting")}</Label>
                  <NativeSelect
                    defaultValue={listing.accessibility.setting ?? ""}
                    id="listing-setting"
                    name="setting"
                  >
                    <NativeSelectOption value="">
                      {translate(locale, "listing.unknown")}
                    </NativeSelectOption>
                    <NativeSelectOption value="indoor">
                      {translate(locale, "listing.indoor")}
                    </NativeSelectOption>
                    <NativeSelectOption value="outdoor">
                      {translate(locale, "listing.outdoor")}
                    </NativeSelectOption>
                    <NativeSelectOption value="both">
                      {translate(locale, "listing.both")}
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>
            </FieldSet>

            <FieldSet className={section}>
              <FieldLegend className="float-left mb-1 w-full">
                {translate(locale, "listing.items")}
              </FieldLegend>
              <FieldDescription>{translate(locale, "listing.itemsHelp")}</FieldDescription>
              {items.map((item, index) => (
                <div
                  className="grid gap-4 rounded-xl border bg-muted/40 p-4 sm:grid-cols-2"
                  key={item.key}
                >
                  <Field className="sm:col-span-2">
                    <Label htmlFor={`item-name-${item.key}`}>
                      {translate(locale, "listing.itemName")} {index + 1}
                    </Label>
                    <Input
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
                  </Field>
                  <Field>
                    <Label htmlFor={`item-category-${item.key}`}>
                      {translate(locale, "listing.itemCategory")}
                    </Label>
                    <NativeSelect
                      id={`item-category-${item.key}`}
                      onChange={(event) => {
                        const categoryId = event.currentTarget.value;
                        setItems((current) =>
                          current.map((row) =>
                            row.key === item.key ? { ...row, categoryId } : row,
                          ),
                        );
                      }}
                      value={item.categoryId}
                    >
                      {enabled.map((category) => (
                        <NativeSelectOption key={category.id} value={category.id}>
                          {category.label[locale]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <Label htmlFor={`item-price-${item.key}`}>
                      {translate(locale, "listing.itemPrice")}
                    </Label>
                    <Input
                      id={`item-price-${item.key}`}
                      inputMode="numeric"
                      onChange={(event) => {
                        const text = event.currentTarget.value.trim();
                        const kronor = Number(text.replace(",", "."));
                        const priceMinor =
                          text && Number.isFinite(kronor) ? Math.round(kronor * 100) : null;
                        setItems((current) =>
                          current.map((row) =>
                            row.key === item.key ? { ...row, priceMinor } : row,
                          ),
                        );
                      }}
                      defaultValue={item.priceMinor === null ? "" : String(item.priceMinor / 100)}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                    <ChoiceField className="items-center">
                      <Checkbox
                        checked={item.status === "sold"}
                        className="mt-0"
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
                      />
                      <span>{translate(locale, "listing.sold")}</span>
                    </ChoiceField>
                    <Button
                      onClick={() =>
                        setItems((current) => current.filter((row) => row.key !== item.key))
                      }
                      type="button"
                      variant="link"
                    >
                      {translate(locale, "listing.remove")}
                    </Button>
                  </div>
                </div>
              ))}
              {items.length < 20 && defaultCategory ? (
                <div>
                  <Button
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
                    variant="outline"
                  >
                    {translate(locale, "listing.addItem")}
                  </Button>
                </div>
              ) : null}
              <FieldDescription>{translate(locale, "listing.priceNotice")}</FieldDescription>
            </FieldSet>

            <FieldSet className={section}>
              <FieldLegend className="float-left mb-1 w-full">
                {translate(locale, "listing.availability")}
              </FieldLegend>
              <FieldDescription>{translate(locale, "listing.availabilityHelp")}</FieldDescription>
              {slots.map((slot, index) => (
                <div
                  className="grid items-end gap-4 rounded-xl border bg-muted/40 p-4 sm:grid-cols-[1fr_1fr_auto]"
                  key={slot.key}
                >
                  <Field>
                    <Label htmlFor={`slot-start-${slot.key}`}>
                      {translate(locale, "dashboard.startsAt")} {index + 1}
                    </Label>
                    <Input
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
                  </Field>
                  <Field>
                    <Label htmlFor={`slot-end-${slot.key}`}>
                      {translate(locale, "dashboard.endsAt")} {index + 1}
                    </Label>
                    <Input
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
                  </Field>
                  <Button
                    className="justify-self-start"
                    onClick={() =>
                      setSlots((current) => current.filter((row) => row.key !== slot.key))
                    }
                    type="button"
                    variant="link"
                  >
                    {translate(locale, "listing.remove")}
                  </Button>
                </div>
              ))}
              {slots.length < 10 ? (
                <div>
                  <Button
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
                    variant="outline"
                  >
                    {translate(locale, "listing.addAvailability")}
                  </Button>
                </div>
              ) : null}
            </FieldSet>

            <ChoiceField className="border-t pt-5">
              <Checkbox defaultChecked={listing.earlyVisibilityOptOut} name="earlyOptOut" />
              <span>{translate(locale, "listing.earlyOptOut")}</span>
            </ChoiceField>
          </CardContent>
          <CardFooter className="border-t">
            <Button disabled={busy} type="submit">
              {busy ? translate(locale, "common.saving") : translate(locale, "listing.save")}
            </Button>
            <p aria-live="polite" className="min-h-6 text-sm font-semibold">
              {status}
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
