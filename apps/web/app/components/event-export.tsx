import { PromenadisApiError } from "@promenadis/api-client";
import type { DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useState } from "react";
import { getPromenadisApiClient } from "../lib/supabase";

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
    <section aria-labelledby="export-heading" className="panel">
      <h2 id="export-heading">{translate(locale, "export.title")}</h2>
      <p className="field-hint">{translate(locale, "export.hint")}</p>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => void download()}
        type="button"
      >
        {translate(locale, "export.download")}
      </button>
      <p aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}
