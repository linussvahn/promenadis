// Fixed plain-text application notices. The only variable is the public
// event title; no names, addresses, reasons, links or other user text.
const texts = {
  address_change_approved: [
    "Your new address for {event} has been approved.",
    "Din nya adress för {event} har godkänts.",
  ],
  appeal_decided: [
    "Your appeal about {event} has been decided.",
    "Ditt överklagande om {event} har avgjorts.",
  ],
  event_cancelled: ["{event} has been cancelled.", "{event} har ställts in."],
  event_postponed: [
    "{event} has been postponed. You will be asked to confirm a new date.",
    "{event} har skjutits upp. Du får bekräfta ett nytt datum.",
  ],
  event_reminder: ["{event} starts tomorrow.", "{event} börjar i morgon."],
  event_rescheduled: [
    "{event} has a new date. Confirm whether you can take part.",
    "{event} har fått ett nytt datum. Bekräfta om du kan vara med.",
  ],
  location_quarantined: [
    "Your stop at {event} is hidden from visitors while a report is reviewed.",
    "Ditt stopp på {event} är dolt för besökare medan en anmälan granskas.",
  ],
  location_restored: [
    "Your stop at {event} is visible to visitors again.",
    "Ditt stopp på {event} syns för besökare igen.",
  ],
  report_reviewed: [
    "Thank you. Your report about {event} has been reviewed.",
    "Tack. Din anmälan om {event} har granskats.",
  ],
  seller_approved: [
    "You have a place as a seller at {event}.",
    "Du har fått en säljplats på {event}.",
  ],
  seller_invited: [
    "You have been invited to sell at {event}. Sign in to Promenadis with this address to accept.",
    "Du har bjudits in att sälja på {event}. Logga in på Promenadis med den här adressen för att tacka ja.",
  ],
  seller_reinstated: [
    "Your place at {event} is active again.",
    "Din plats på {event} är aktiv igen.",
  ],
  seller_rejected: [
    "Your application to {event} was not approved.",
    "Din ansökan till {event} godkändes inte.",
  ],
  seller_revoked: [
    "Your place at {event} has been withdrawn.",
    "Din plats på {event} har dragits tillbaka.",
  ],
  seller_suspended: ["Your place at {event} is paused.", "Din plats på {event} är pausad."],
  seller_waitlisted: [
    "You are on the waiting list for {event}.",
    "Du står på väntelistan till {event}.",
  ],
  team_invited: [
    "You have been invited to help run {event}. Sign in to Promenadis with this address to accept.",
    "Du har bjudits in att hjälpa till med {event}. Logga in på Promenadis med den här adressen för att tacka ja.",
  ],
  unlisted_link_rotated: [
    "The visitor link for {event} has been replaced. Share only the new link.",
    "Besökarlänken till {event} har bytts ut. Dela bara den nya länken.",
  ],
};

const footer = [
  "Open Promenadis directly for details. Do not reply to this message.",
  "Öppna Promenadis direkt för mer information. Svara inte på det här meddelandet.",
];

// Relay mail is the one exception to fixed text: it carries the plain-text
// message body, but never either side's address.
function relayNotice(template, title, recipient, origin) {
  // Drop control characters except newlines and tabs.
  const body = [...String(recipient.body ?? "")]
    .filter((character) => character >= " " || character === "\n" || character === "\t")
    .join("");
  if (template === "relay_to_organizer") {
    return {
      Subject: `Promenadis: ${title}`,
      Text: `Nytt meddelande om ${title} via Promenadis:\n\n${body}\n\nSvara i Promenadis: öppna evenemanget och välj Meddelanden. Besökarens e-postadress visas inte.\n\n—\n\nA new message about ${title} through Promenadis (shown above). Reply in Promenadis under the event's Messages. The visitor's address is not shown.`,
    };
  }
  const link = `${origin}/contact/${recipient.threadId}#${recipient.threadToken}`;
  return {
    Subject: `Promenadis: ${title}`,
    Text: `Svar från arrangören av ${title}:\n\n${body}\n\nLäs tråden och svara: ${link}\nArrangörens e-postadress visas inte.\n\n—\n\nA reply from the organizer of ${title} (shown above). Read the thread and reply: ${link}`,
  };
}

export function applicationNotice(
  template,
  payload,
  locale,
  recipient = {},
  origin = "http://127.0.0.1:5173",
) {
  if (template === "relay_to_organizer" || template === "relay_to_visitor") {
    const title = String(payload?.eventTitle ?? "Promenadis")
      .replace(/[\r\n]+/gu, " ")
      .slice(0, 160);
    return relayNotice(template, title, recipient, origin);
  }
  const text = texts[template];
  if (!text) throw new Error("Unsupported notice");
  const title = String(payload?.eventTitle ?? "Promenadis")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 160);
  const render = (index) => `${text[index].replaceAll("{event}", title)}\n\n${footer[index]}`;
  if (locale === "sv") return { Subject: `Promenadis: ${title}`, Text: render(1) };
  if (locale === "en") return { Subject: `Promenadis: ${title}`, Text: render(0) };
  return { Subject: `Promenadis: ${title}`, Text: `${render(1)}\n\n—\n\n${render(0)}` };
}

// Same contract as security delivery: at least once, acknowledged under the
// database lease, never exactly once.
export async function deliverApplicationBatch({ claim, resolveRecipient, send, finish, origin }) {
  const result = { accepted: 0, failed: 0, skipped: 0, unacknowledged: 0 };
  for (const job of await claim()) {
    let delivered = false;
    let skipped = false;
    try {
      const recipient = await resolveRecipient(job);
      if (!recipient) {
        skipped = true;
        result.skipped++;
      } else {
        delivered = await send(
          recipient.email,
          applicationNotice(job.template, job.payload, recipient.locale, recipient, origin),
          job.job_id,
        );
        if (!delivered) result.failed++;
      }
    } catch {
      result.failed++;
    }
    if (skipped) continue;
    try {
      if (!(await finish(job, delivered))) result.unacknowledged++;
      else if (delivered) result.accepted++;
    } catch {
      result.unacknowledged++;
    }
  }
  return result;
}
