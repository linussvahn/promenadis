import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp-nonce";

describe("contentSecurityPolicy", () => {
  it("allows scripts only from this origin or with the nonce", () => {
    const policy = contentSecurityPolicy("abc123");
    expect(policy).toContain("script-src 'self' 'nonce-abc123'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/unsafe-(inline|eval)/u);
  });
});
