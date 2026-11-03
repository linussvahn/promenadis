import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  if (event.role !== "owner" && event.role !== "co_host") return null;
  const download = async () => {
    const api = getPromenadisApiClient();
    const token = await accessToken();
    if (!api || !token) return;
    setBusy(true);
    setStatus("");
    try {
      const created = await api.createEventExport(token, event.id);
      const csv = await api.downloadEventExport(token, event.id, created.exportId, created.token);
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "promenadis-saljare.csv";
      link.click();
      URL.revokeObjectURL(url);
      setStatus(`${translate(locale, "export.done")} (${created.rows})`);
    } catch (error) {
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
    } finally {
      setBusy(false);
    }
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
