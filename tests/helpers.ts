import { vi } from "vitest";
import { FakeDb } from "./fake-db";

export const KEY = "test-key-not-a-real-secret";
export const OWNER = "owner-uid";
export const fake = new FakeDb();

export function env() {
  process.env.AKNCLIENT_API_KEY = KEY;
  process.env.STARTPAGE_OWNER_UID = OWNER;
}

export const authed = (path: string, init: RequestInit = {}) =>
  new Request(`http://t${path}`, { ...init, headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init.headers as object) } });
export const json = (path: string, method: string, body: unknown, key: string | null = KEY) =>
  new Request(`http://t${path}`, {
    method, body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
  });

export function mockDb() {
  vi.doMock("@/lib/supabase-server", () => ({ db: fake }));
}
