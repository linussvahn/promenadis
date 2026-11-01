// Fixed, plain-text security messages: never include names, addresses, recovery
// destinations, tokens or user-authored event content in a team notice.
const states = {
  started: ["has been requested", "har begärts"],
  ready: ["has reached its waiting-period deadline", "har nått väntetidens slut"],
  cancelled: ["has been cancelled", "har avbrutits"],
  completed: ["has been completed", "har slutförts"],
  expired: ["has expired", "har löpt ut"],
};

export function securityNotice(template, locale) {
  const match =
    /^(account_recovery|event_emergency_claim)_(started|ready|cancelled|completed|expired)$/u.exec(
      template,
    );
  if (!match || (match[1] === "account_recovery" && match[2] === "ready")) {
    throw new Error("Unsupported security notice");
  }
  const swedish = locale === "sv";
  const subject = swedish ? "Säkerhetsmeddelande från Promenadis" : "Promenadis security notice";
  const action = states[match[2]][swedish ? 1 : 0];
  const topic =
    match[1] === "account_recovery"
      ? swedish
        ? "Kontoåterställning för dig eller en ägare i ditt evenemangsteam"
        : "Account recovery for you or an owner in your event team"
      : swedish
        ? "En överföring till utsedd efterträdare i ditt evenemangsteam"
        : "An emergency-successor transfer in your event team";
  const guidance = swedish
    ? "Öppna Promenadis direkt och kontrollera Inställningar och ditt evenemangsteam. Om du är berörd kontoägare och inte begärde detta, logga in och avbryt en eventuell pågående begäran. Dela aldrig inloggnings- eller återställningskoder."
    : "Open Promenadis directly and review Settings and your event team. If you are the affected account owner and did not request this, sign in and cancel any pending request. Never share sign-in or recovery codes.";
  const preview = swedish
    ? "Lokalt test: kontoåterställning kan ännu inte ändra inloggningsadressen."
    : "Local test: account recovery cannot yet change the sign-in email.";
  return { Subject: subject, Text: `${topic} ${action}.\n\n${guidance}\n\n${preview}` };
}

// Injected boundary makes failures testable without sending or persisting mail.
// Acknowledgement is fenced by the database lease. An ambiguous send can be
// retried, so this is at-least-once delivery, not an exactly-once guarantee.
export async function deliverSecurityBatch({ claim, resolveRecipient, send, finish }) {
  const result = { accepted: 0, failed: 0, skipped: 0, unacknowledged: 0 };
  for (const job of await claim()) {
    let delivered = false;
    try {
      const recipient = await resolveRecipient(job);
      if (!recipient) {
        result.skipped++;
      } else {
        const message = securityNotice(job.template_key, recipient.locale);
        delivered = await send(recipient.email, message, job.job_id);
        if (!delivered) result.failed++;
      }
    } catch {
      result.failed++;
    }
    try {
      const acknowledged = await finish(job, delivered);
      if (!acknowledged) result.unacknowledged++;
      else if (delivered) result.accepted++;
    } catch {
      result.unacknowledged++;
    }
  }
  return result;
}
