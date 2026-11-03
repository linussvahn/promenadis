import { type createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import type { EventTaxonomy } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { accountKey } from "../lib/use-account-data";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, Field, FieldDescription } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

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
  const accountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(new Set());
  const [synced, setSynced] = useState<EventTaxonomy | null>(null);
  const [status, setStatus] = useState("");
  const taxonomyKey = accountKey(accountId, "event", eventId, "taxonomy");

  const taxonomyQuery = useQuery({
    queryKey: taxonomyKey,
    queryFn: async () => {
      const client = await call();
      return client ? client.api.getEventTaxonomy(client.token, eventId) : null;
    },
  });
  const taxonomy = taxonomyQuery.data ?? null;

  // Reset the local order and choices whenever the server copy changes.
  if (taxonomy && taxonomy !== synced) {
    setSynced(taxonomy);
    setOrder(taxonomy.categories.map((category) => category.id));
    setEnabled(
      new Set(taxonomy.categories.filter((category) => category.enabled).map((c) => c.id)),
    );
  }

  const saveTaxonomy = useMutation({
    mutationFn: async (input: Parameters<ApiClient["saveEventTaxonomy"]>[2]) => {
      const client = await call();
      return client ? client.api.saveEventTaxonomy(client.token, eventId, input) : null;
    },
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(taxonomyKey, next);
    },
  });
  const busy = saveTaxonomy.isPending;

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
    setStatus("");
    try {
      const saved = await saveTaxonomy.mutateAsync({
        enabledCategoryIds: order.filter((id) => enabled.has(id)),
        expectedVersion: taxonomy.version,
        suggestedTags: suggestions,
      });
      if (saved) setStatus(translate(locale, "taxonomy.saved"));
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
    }
  };

  const byId = new Map(taxonomy.categories.map((category) => [category.id, category]));

  return (
    <Card
      asChild
      className="gap-0 py-0 [&>summary]:flex [&>summary]:min-h-16 [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:px-6 [&>summary]:py-4 [&>summary]:font-display [&>summary]:text-lg [&>summary]:font-extrabold"
    >
      <details>
        <summary>{translate(locale, "taxonomy.title")}</summary>
        <form className="grid gap-5 border-t px-6 pt-5 pb-6" key={taxonomy.version} onSubmit={save}>
          <FieldDescription>
            {translate(locale, editable ? "taxonomy.help" : "taxonomy.pinned")}
          </FieldDescription>
          <ol className="m-0 grid list-none divide-y rounded-xl border p-0">
            {order.map((id, index) => {
              const category = byId.get(id);
              if (!category) return null;
              return (
                <li className="flex min-h-12 items-center gap-2 py-1 pr-1 pl-4" key={id}>
                  <ChoiceField className="flex-1 items-center py-2">
                    <Checkbox
                      checked={enabled.has(id)}
                      className="mt-0"
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
                    />
                    <span>{category.label[locale]}</span>
                  </ChoiceField>
                  {editable ? (
                    <>
                      <Button
                        aria-label={`${translate(locale, "boundary.moveUp")}: ${category.label[locale]}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        ↑
                      </Button>
                      <Button
                        aria-label={`${translate(locale, "boundary.moveDown")}: ${category.label[locale]}`}
                        disabled={index === order.length - 1}
                        onClick={() => move(index, 1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        ↓
                      </Button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <Field>
            <Label htmlFor="suggested-tags">{translate(locale, "taxonomy.suggestedTags")}</Label>
            <Textarea
              defaultValue={taxonomy.suggestedTags.join("\n")}
              disabled={!editable}
              id="suggested-tags"
              name="suggestedTags"
              rows={4}
            />
          </Field>
          {editable ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={busy} type="submit" variant="outline">
                {translate(locale, "taxonomy.save")}
              </Button>
            </div>
          ) : null}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {status}
          </p>
        </form>
      </details>
    </Card>
  );
}
