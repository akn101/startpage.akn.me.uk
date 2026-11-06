import { describe, it, expect, beforeEach } from "vitest";
import { authorizeAknclient } from "@/lib/aknclient-auth";

describe("authorizeAknclient", () => {
  beforeEach(() => { process.env.AKNCLIENT_API_KEY = "k1"; });
  const req = (h?: string) => new Request("http://t/", { headers: h ? { authorization: h } : {} });
  it("503 when env var missing", async () => {
    delete process.env.AKNCLIENT_API_KEY;
    expect(authorizeAknclient(req("Bearer k1"))!.status).toBe(503);
  });
  it("401 missing / wrong / non-bearer", () => {
    expect(authorizeAknclient(req())!.status).toBe(401);
    expect(authorizeAknclient(req("Bearer nope"))!.status).toBe(401);
    expect(authorizeAknclient(req("k1"))!.status).toBe(401);
  });
  it("null when correct", () => { expect(authorizeAknclient(req("Bearer k1"))).toBeNull(); });
});
