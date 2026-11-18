import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, fake, json, mockDb, OWNER } from "./helpers";

let ownerOk = true;
beforeEach(() => {
  vi.resetModules(); env(); mockDb(); fake.tables = {}; ownerOk = true;
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<object>()),
    requireOwner: async () => (ownerOk ? { uid: OWNER } : new Response("no", { status: 401 })),
  }));
});

const ART = "data:image/jpeg;base64,AAAA";

describe("aknClient music relay", () => {
  it("rejects a PUT without the aknClient key", async () => {
    const { PUT } = await import("@/app/api/aknclient/music/state/route");
    const r = await PUT(json("/api/aknclient/music/state", "PUT", { state: null }, "wrong"));
    expect(r.status).toBe(401);
  });

  it("stores state and artwork; omitted artwork keeps it, empty clears it", async () => {
    const { PUT } = await import("@/app/api/aknclient/music/state/route");
    const { GET } = await import("@/app/api/music/mac/route");
    const st = { title: "Song", artist: "A", album: "B", playing: true, position: 12, duration: 200, volume: 40, evil: "x" };
    expect((await PUT(json("/", "PUT", { state: st, trackId: "t1", artwork: ART }))).status).toBe(200);
    let g = await (await GET()).json();
    expect(g).toMatchObject({ online: true, running: true, title: "Song", playing: true, volume: 40, artwork: ART });
    expect(g.evil).toBeUndefined();
    await PUT(json("/", "PUT", { state: { ...st, position: 13 }, trackId: "t1" }));
    g = await (await GET()).json();
    expect(g.artwork).toBe(ART);
    await PUT(json("/", "PUT", { state: st, trackId: "t2", artwork: "" }));
    expect((await (await GET()).json()).artwork).toBeNull();
  });

  it("reports offline when the Mac has not reported for a minute", async () => {
    fake.seed("mac_music", [{ id: 1, state: { title: "x" }, updated_at: new Date(Date.now() - 120_000).toISOString() }]);
    const { GET } = await import("@/app/api/music/mac/route");
    expect((await (await GET()).json()).online).toBe(false);
  });

  it("owner routes need the owner", async () => {
    ownerOk = false;
    const { GET, POST } = await import("@/app/api/music/mac/route");
    expect((await GET()).status).toBe(401);
    expect((await POST(json("/", "POST", { fn: "pause" }, null))).status).toBe(401);
  });

  it("queues validated commands and aknClient claims each once", async () => {
    const { POST } = await import("@/app/api/music/mac/route");
    const { GET } = await import("@/app/api/aknclient/music/commands/route");
    expect((await POST(json("/", "POST", { fn: "rm -rf" }, null))).status).toBe(400);
    expect((await (await POST(json("/", "POST", { fn: "volume", arg: "150" }, null))).json()).queued).toEqual({ fn: "volume", arg: "100" });
    await POST(json("/", "POST", { fn: "next", arg: "ignored" }, null));
    await POST(json("/", "POST", { fn: "play", arg: " Radiohead " }, null));
    fake.rows("mac_music_commands").forEach((r) => (r.created_at = new Date().toISOString()));
    const req = (k = "test-key-not-a-real-secret") => new Request("http://t/api/aknclient/music/commands?wait=0", { headers: { authorization: `Bearer ${k}` } });
    expect((await GET(req("nope"))).status).toBe(401);
    const { commands } = await (await GET(req())).json();
    expect(commands.map((c: { fn: string; arg: string | null }) => [c.fn, c.arg])).toEqual([["volume", "100"], ["next", null], ["play", "Radiohead"]]);
    expect((await (await GET(req())).json()).commands).toEqual([]);
  });

  it("drops commands older than two minutes", async () => {
    fake.seed("mac_music_commands", [{ id: 1, fn: "pause", arg: null, created_at: new Date(Date.now() - 300_000).toISOString() }]);
    const { GET } = await import("@/app/api/aknclient/music/commands/route");
    const r = await GET(new Request("http://t/x?wait=0", { headers: { authorization: "Bearer test-key-not-a-real-secret" } }));
    expect((await r.json()).commands).toEqual([]);
  });

  it("macActive follows the last report", async () => {
    const { macActive } = await import("@/lib/mac-music");
    expect(await macActive()).toBe(false);
    fake.seed("mac_music", [{ id: 1, updated_at: new Date().toISOString() }]);
    expect(await macActive()).toBe(true);
    fake.seed("mac_music", [{ id: 1, updated_at: new Date(Date.now() - 8 * 86400_000).toISOString() }]);
    expect(await macActive()).toBe(false);
  });
});
