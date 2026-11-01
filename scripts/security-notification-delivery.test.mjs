import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverSecurityBatch, securityNotice } from "./security-notification-delivery.mjs";

const job = { job_id: "job", lease_id: "lease", template_key: "account_recovery_started" };
function dependencies(overrides = {}) {
  return {
    claim: async () => [job],
    resolveRecipient: async () => ({ email: "recipient@example.invalid", locale: "sv" }),
    send: async () => true,
    finish: async () => true,
    ...overrides,
  };
}

test("all security templates have fixed Swedish and English plain text", () => {
  for (const prefix of ["account_recovery", "event_emergency_claim"]) {
    for (const state of ["started", "cancelled", "completed", "expired", "ready"]) {
      if (prefix === "account_recovery" && state === "ready") continue;
      const sv = securityNotice(`${prefix}_${state}`, "sv");
      const en = securityNotice(`${prefix}_${state}`, "en");
      assert.notEqual(sv.Text, en.Text);
      assert.equal(sv.HTML, undefined);
      assert.match(en.Text, /Local test/u);
    }
  }
  assert.throws(() => securityNotice("account_recovery_verify_new_email", "en"));
  assert.throws(() => securityNotice("custom_user_message", "en"));
});

test("accepted mail is acknowledged using the original job and stable ID", async () => {
  const result = await deliverSecurityBatch(
    dependencies({
      send: async (email, message, id) => {
        assert.equal(email, "recipient@example.invalid");
        assert.equal(id, job.job_id);
        assert.match(message.Subject, /Säkerhet/u);
        return true;
      },
      finish: async (value, delivered) => {
        assert.equal(value, job);
        assert.equal(delivered, true);
        return true;
      },
    }),
  );
  assert.deepEqual(result, { accepted: 1, failed: 0, skipped: 0, unacknowledged: 0 });
});

test("failed and ambiguous sends request retry rather than recording success", async () => {
  for (const send of [
    async () => false,
    async () => {
      throw new Error("private provider error");
    },
  ]) {
    const result = await deliverSecurityBatch(
      dependencies({
        send,
        finish: async (_, delivered) => {
          assert.equal(delivered, false);
          return true;
        },
      }),
    );
    assert.equal(result.failed, 1);
    assert.equal(result.accepted, 0);
  }
});

test("cancelled/expired/unavailable recipient never sends", async () => {
  const result = await deliverSecurityBatch(
    dependencies({
      resolveRecipient: async () => null,
      send: async () => {
        assert.fail("must not send");
      },
    }),
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.accepted, 0);
});

test("lost or rejected acknowledgement is visible, not counted as completed", async () => {
  for (const finish of [
    async () => false,
    async () => {
      throw new Error("lost acknowledgement");
    },
  ]) {
    const result = await deliverSecurityBatch(dependencies({ finish }));
    assert.equal(result.accepted, 0);
    assert.equal(result.unacknowledged, 1);
  }
});

test("one failed job does not prevent the next from running", async () => {
  let calls = 0;
  const result = await deliverSecurityBatch(
    dependencies({
      claim: async () => [job, job],
      send: async () => ++calls > 1,
    }),
  );
  assert.equal(result.accepted, 1);
  assert.equal(result.failed, 1);
});
