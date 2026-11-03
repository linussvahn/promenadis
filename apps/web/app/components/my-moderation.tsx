import { PromenadisApiError } from "@promenadis/api-client";
import type { MyModerationAction } from "@promenadis/contracts";
import { formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Field } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// Decisions that affected the signed-in seller, with an appeal per decision.
export function MyModeration({
  accessToken,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly locale: Locale;
}) {
  const queryClient = useQueryClient();
  const moderationKey = accountKey(useExpectedAccountId(), "moderation");
  const [status, setStatus] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: moderationKey,
    queryFn: async (): Promise<MyModerationAction[]> => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return [];
      return api.listMyModeration(token);
    },
    // The events list above already reports session problems.
    throwOnError: false,
  });

  const submitAppeal = useMutation({
    mutationFn: async ({ item, statement }: { item: MyModerationAction; statement: string }) => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return null;
      return api.submitAppeal(token, item.id, statement);
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "appeal_window_closed"
            ? "appeal.windowClosed"
            : code === "invalid_request"
              ? "appeal.tooShort"
              : "appeal.error",
        ),
      );
    },
    onSuccess: (next) => {
      if (!next) return;
      queryClient.setQueryData(moderationKey, next);
      setStatus(translate(locale, "appeal.sent"));
    },
  });

  const appeal = (item: MyModerationAction, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const statement = String(new FormData(formEvent.currentTarget).get("statement") ?? "").trim();
    submitAppeal.mutate({ item, statement });
  };

  if (items.length === 0) return null;

  return (
    <Card aria-labelledby="my-moderation-heading" asChild>
      <section>
        <CardHeader>
          <CardTitle id="my-moderation-heading">{translate(locale, "appeal.title")}</CardTitle>
          <CardDescription>{translate(locale, "appeal.help")}</CardDescription>
        </CardHeader>
        <CardContent className="gap-0 divide-y">
          {items.map((item) => (
            <article className="grid gap-3 py-5 first:pt-0 last:pb-0" key={item.id}>
              <h3 className="text-lg font-bold">
                {item.eventTitle}: {translate(locale, `appeal.action.${item.action}`)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(locale, item.createdAt, "Europe/Stockholm")}
                {item.reason ? ` · ${item.reason}` : ""}
              </p>
              {item.appeal ? (
                <p>
                  {translate(locale, `appeal.state.${item.appeal.state}`)}
                  {item.appeal.decisionReason ? ` · ${item.appeal.decisionReason}` : ""}
                  {item.appeal.independent === false
                    ? ` ${translate(locale, "appeal.notIndependent")}`
                    : ""}
                </p>
              ) : (
                <form
                  className="grid max-w-xl gap-4"
                  onSubmit={(formEvent) => appeal(item, formEvent)}
                >
                  <Field>
                    <Label htmlFor={`appeal-${item.id}`}>
                      {translate(locale, "appeal.statement")}
                    </Label>
                    <Textarea
                      id={`appeal-${item.id}`}
                      maxLength={1000}
                      minLength={10}
                      name="statement"
                      required
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="outline">
                      {translate(locale, "appeal.submit")}
                    </Button>
                  </div>
                </form>
              )}
            </article>
          ))}
          <p aria-live="polite" className="min-h-6 pt-4 text-sm font-semibold">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
