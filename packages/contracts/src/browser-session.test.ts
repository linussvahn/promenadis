import { expect, it } from "vitest";
import { browserSessionResponseSchema, browserOtpVerifySchema } from "./schemas";

it("browser session DTOs exclude credentials and OTP verification binds the displayed email", () => {
  const user = { id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606", email: "synthetic@example.invalid" };
  expect(
    browserSessionResponseSchema.safeParse({ schemaVersion: "1.0", session: { user } }).success,
  ).toBe(true);
  expect(
    browserSessionResponseSchema.safeParse({
      schemaVersion: "1.0",
      session: { user, access_token: "forbidden" },
    }).success,
  ).toBe(false);
  expect(
    browserSessionResponseSchema.safeParse({
      schemaVersion: "1.0",
      session: { user, refreshToken: "forbidden" },
    }).success,
  ).toBe(false);
  expect(browserOtpVerifySchema.safeParse({ token: "123456" }).success).toBe(false);
  expect(browserOtpVerifySchema.safeParse({ email: user.email, token: "123456" }).success).toBe(
    true,
  );
});
