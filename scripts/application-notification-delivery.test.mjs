import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicationNotice,
  deliverApplicationBatch,
} from "./application-notification-delivery.mjs";

test("notices carry only the event title, in the recipient's language or both", () => {
  const sv = applicationNotice("seller_approved", { eventTitle: "Vårloppis\nRad två" }, "sv");
  assert.equal(sv.Subject, "Promenadis: Vårloppis Rad två");
  assert.match(sv.Text, /säljplats på Vårloppis Rad två/u);
  assert.doesNotMatch(sv.Text, /https?:/u);
  const both = applicationNotice("report_reviewed", { eventTitle: "Walk" }, "both");
  assert.match(both.Text, /har granskats[\s\S]*has been reviewed/u);
  assert.throws(() => applicationNotice("free_text", {}, "sv"));
});

test("skipped recipients are not acknowledged; failures are", async () => {
  const finished = [];
  const result = await deliverApplicationBatch({
    claim: async () => [
      { job_id: "a", lease_id: "1", payload: { eventTitle: "E" }, template: "seller_approved" },
      { job_id: "b", lease_id: "2", payload: { eventTitle: "E" }, template: "seller_rejected" },
      { job_id: "c", lease_id: "3", payload: { eventTitle: "E" }, template: "seller_revoked" },
    ],
    finish: async (job, delivered) => {
      finished.push([job.job_id, delivered]);
      return true;
    },
    resolveRecipient: async (job) =>
      job.job_id === "c" ? null : { email: "x@example.invalid", locale: "en" },
    send: async (_email, _message, id) => id === "a",
  });
  assert.deepEqual(result, { accepted: 1, failed: 1, skipped: 1, unacknowledged: 0 });
  assert.deepEqual(finished, [
    ["a", true],
    ["b", false],
  ]);
});
