import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

// Owners and co-hosts download approved sellers' public operational fields.
export function EventExport({
  accessToken,
  event,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const [status, setStatus] = useState("");
  // Each export is a new, rate-limited server job, so it is a mutation.
  const exportMutation = useMutation({
    mutationFn: async ({
      api,
      token,
    }: {
      api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
      token: string;
    }) => {
      const created = await api.createEventExport(token, event.id);
      const csv = await api.downloadEventExport(token, event.id, created.exportId, created.token);
      return { csv, rows: created.rows };
    },
    onError: (error) => {
      const code = error instanceof PromenadisApiError ? error.code : "";
      setStatus(
        translate(
          locale,
          code === "recent_auth_required"
            ? "lifecycle.recentAuth"
            : code === "rate_limited"
              ? "export.limit"
              : code === "export_active"
                ? "export.active"
                : "export.error",
        ),
      );
    },
    onMutate: () => setStatus(""),
    onSuccess: ({ csv, rows }) => {
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "promenadis-saljare.csv";
      link.click();
      URL.revokeObjectURL(url);
      setStatus(`${translate(locale, "export.done")} (${rows})`);
    },
  });
  const busy = exportMutation.isPending;
  if (event.role !== "owner" && event.role !== "co_host") return null;
  const download = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    exportMutation.mutate({ api, token });
  };
  return (
    <Card asChild>
      <section aria-labelledby="export-heading">
        <CardHeader>
          <CardTitle id="export-heading">{translate(locale, "export.title")}</CardTitle>
          <CardDescription>{translate(locale, "export.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="justify-items-start gap-3">
          <Button disabled={busy} onClick={() => void download()} type="button" variant="outline">
            {translate(locale, "export.download")}
          </Button>
          <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
            {status}
          </p>
        </CardContent>
      </section>
    </Card>
  );
}
