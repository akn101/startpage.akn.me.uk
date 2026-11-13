"use client";

// Music on the TV, inside the TV app's WebView. The backend comes from
// /api/tv/config: "apple" plays through MusicKit JS v3; "subsonic" plays our
// server-proxied stream URLs in an <audio> element (credentials never reach
// the TV). Either way the native app drives it through window.spMusic and
// hears back through window.StartpageTV.onMusicState(json) on every change.
import { useCallback, useEffect, useRef, useState } from "react";

const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

type Backend = "apple" | "subsonic" | null;
type Track = { id: string; title: string; artist: string | null; album: string | null; coverUrl: string | null; streamUrl: string; duration: number | null };

type MusicState = {
  backend: Backend;
  ready: boolean;
  authorized: boolean;
  playing: boolean;
  state: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork: string | null;
  position: number;
  duration: number;
  error: string | null;
};

const EMPTY: MusicState = {
  backend: null, ready: false, authorized: false, playing: false, state: "none",
  title: null, artist: null, album: null, artwork: null, position: 0, duration: 0, error: null,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    MusicKit?: any;
    spMusic?: {
      play: (query: string) => Promise<boolean>;
      pause: () => void;
      resume: () => void;
      next: () => void;
      prev: () => void;
      state: () => MusicState;
    };
    StartpageTV?: { onMusicState?: (json: string) => void };
  }
}

function loadMusicKit(): Promise<any> {
  if (window.MusicKit?.configure) return Promise.resolve(window.MusicKit);
  return new Promise((resolve, reject) => {
    document.addEventListener("musickitloaded", () => resolve(window.MusicKit), { once: true });
    if (!document.querySelector(`script[src="${MUSICKIT_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = MUSICKIT_SRC;
      s.async = true;
      s.dataset.webComponents = "";
      s.onerror = () => reject(new Error("MusicKit failed to load"));
      document.head.appendChild(s);
    }
  });
}

const STATES = ["none", "loading", "playing", "paused", "stopped", "ended", "seeking", "waiting", "stalled", "completed"];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const httpErr = (status: number, what: string) =>
  status === 423 ? "Enter your PIN first" : status === 503 ? `${what} isn't set up` : status === 401 ? "Sign in first" : `${what} error ${status}`;
// "play some music", "shuffle", "anything" → random tracks rather than a search.
const WANTS_RANDOM = /^(some |any |random |my )?(music|songs?|tunes|anything|something|shuffle|random)( please)?$/i;

export default function MusicPlayer() {
  const [st, setSt] = useState<MusicState>(EMPTY);
  const mk = useRef<any>(null);
  const stRef = useRef<MusicState>(EMPTY);

  const publish = useCallback((patch: Partial<MusicState> = {}) => {
    const m = mk.current;
    const item = m?.nowPlayingItem;
    const art = item?.attributes?.artwork ?? item?.artwork;
    const next: MusicState = {
      ...stRef.current,
      ...(m
        ? {
            ready: true,
            authorized: !!m.isAuthorized,
            playing: !!m.isPlaying,
            state: STATES[m.playbackState] ?? String(m.playbackState),
            title: item?.attributes?.name ?? item?.title ?? null,
            artist: item?.attributes?.artistName ?? item?.artistName ?? null,
            album: item?.attributes?.albumName ?? item?.albumName ?? null,
            artwork: art && window.MusicKit?.formatArtworkURL ? window.MusicKit.formatArtworkURL(art, 600, 600) : null,
            position: Math.round(m.currentPlaybackTime ?? 0),
            duration: Math.round(m.currentPlaybackDuration ?? 0),
          }
        : {}),
      ...patch,
    };
    stRef.current = next;
    setSt(next);
    try { window.StartpageTV?.onMusicState?.(JSON.stringify(next)); } catch { /* native bridge gone */ }
  }, []);

  const play = useCallback(async (query: string): Promise<boolean> => {
    const m = mk.current;
    if (!m) return false;
    try {
      if (!m.isAuthorized) await m.authorize();
      const q = norm(query);
      // 1. A library playlist whose name matches.
      try {
        const lib = await m.api.music("/v1/me/library/playlists", { limit: 100 });
        const hit = (lib?.data?.data ?? []).find((p: any) => {
          const n = norm(p.attributes?.name ?? "");
          return n && (n === q || n.includes(q) || q.includes(n));
        });
        if (hit) {
          await m.setQueue({ playlist: hit.id, startPlaying: true });
          await m.play();
          publish({ error: null });
          return true;
        }
      } catch { /* no library access; fall through to catalog */ }
      // 2. Catalog search: best song, else album, else playlist.
      const sf = m.storefrontId || "us";
      const r = await m.api.music(`/v1/catalog/${sf}/search`, { term: query, types: "songs,albums,playlists", limit: 5 });
      const res = r?.data?.results ?? {};
      const wantsAlbum = /\balbum\b/i.test(query);
      const wantsPlaylist = /\bplaylist\b|\bmix\b|\bradio\b/i.test(query);
      const song = res.songs?.data?.[0];
      const album = res.albums?.data?.[0];
      const playlist = res.playlists?.data?.[0];
      const pick =
        (wantsPlaylist && playlist && { playlist: playlist.id }) ||
        (wantsAlbum && album && { album: album.id }) ||
        (song && { song: song.id }) ||
        (album && { album: album.id }) ||
        (playlist && { playlist: playlist.id });
      if (!pick) { publish({ error: `Nothing found for "${query}"` }); return false; }
      await m.setQueue({ ...pick, startPlaying: true });
      await m.play();
      publish({ error: null });
      return true;
    } catch (e) {
      publish({ error: e instanceof Error ? e.message : "Playback failed" });
      return false;
    }
  }, [publish]);

  // ---- Subsonic: our proxy URLs in a plain <audio> element ----
  const audio = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Track[]>([]);
  const qi = useRef(0);

  const publishAudio = useCallback((patch: Partial<MusicState> = {}) => {
    const a = audio.current;
    const t = queue.current[qi.current];
    const next: MusicState = {
      ...stRef.current,
      backend: "subsonic",
      ready: true,
      authorized: true,
      playing: !!a && !a.paused && !a.ended,
      state: !a || !t ? "none" : a.ended ? "ended" : a.paused ? "paused" : a.readyState < 3 ? "loading" : "playing",
      title: t?.title ?? null,
      artist: t?.artist ?? null,
      album: t?.album ?? null,
      artwork: t?.coverUrl ?? null,
      position: Math.round(a?.currentTime ?? 0),
      duration: Math.round(Number.isFinite(a?.duration) ? a!.duration : t?.duration ?? 0),
      ...patch,
    };
    stRef.current = next;
    setSt(next);
    try { window.StartpageTV?.onMusicState?.(JSON.stringify(next)); } catch { /* native bridge gone */ }
  }, []);

  const playAt = useCallback(async (i: number): Promise<boolean> => {
    const a = audio.current;
    const t = queue.current[i];
    if (!a || !t) return false;
    qi.current = i;
    a.src = t.streamUrl;
    try { await a.play(); publishAudio({ error: null }); return true; }
    catch (e) { publishAudio({ error: e instanceof Error ? e.message : "Playback failed" }); return false; }
  }, [publishAudio]);

  const playSubsonic = useCallback(async (query: string): Promise<boolean> => {
    const q = query.trim();
    const url = !q || WANTS_RANDOM.test(q) ? "/api/music/subsonic/random" : `/api/music/subsonic/search?q=${encodeURIComponent(q)}`;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) { publishAudio({ error: httpErr(r.status, "Music library") }); return false; }
      const list = (await r.json()) as Track[];
      if (!list.length) { publishAudio({ error: `Nothing found for "${q}"` }); return false; }
      queue.current = list;
      return playAt(0);
    } catch (e) {
      publishAudio({ error: e instanceof Error ? e.message : "Search failed" });
      return false;
    }
  }, [playAt, publishAudio]);

  const startSubsonic = useCallback(() => {
    const a = new Audio();
    a.preload = "auto";
    audio.current = a;
    let last = 0;
    for (const ev of ["play", "pause", "playing", "waiting", "loadedmetadata"]) a.addEventListener(ev, () => publishAudio());
    a.addEventListener("timeupdate", () => { const now = Date.now(); if (now - last > 1000) { last = now; publishAudio(); } });
    a.addEventListener("ended", () => { if (qi.current + 1 < queue.current.length) void playAt(qi.current + 1); else publishAudio(); });
    a.addEventListener("error", () => publishAudio({ error: "Couldn't play this track" }));
    window.spMusic = {
      play: playSubsonic,
      pause: () => { a.pause(); },
      resume: () => { if (a.src) void a.play(); else void playSubsonic(""); },
      next: () => { if (qi.current + 1 < queue.current.length) void playAt(qi.current + 1); },
      prev: () => { if (a.currentTime > 5 || qi.current === 0) a.currentTime = 0; else void playAt(qi.current - 1); },
      state: () => stRef.current,
    };
    publishAudio({ error: null });
    return () => { a.pause(); a.removeAttribute("src"); a.load(); };
  }, [playAt, playSubsonic, publishAudio]);

  useEffect(() => {
    let cancelled = false;
    let stopAudio: (() => void) | null = null;
    (async () => {
      let backend: Backend = null;
      try {
        const c = await fetch("/api/tv/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
        backend = c?.music?.backend ?? null;
      } catch { /* offline: shows "not set up" below */ }
      if (cancelled) return;
      if (backend === "subsonic") { stopAudio = startSubsonic(); return; }
      if (backend === null) { publish({ backend: null, error: "No music service is set up" }); return; }
      stopAudio = startApple();
    })();
    return () => { cancelled = true; stopAudio?.(); delete window.spMusic; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSubsonic]);

  // ---- Apple Music (MusicKit JS v3) ----
  const startApple = () => {
    let cancelled = false;
    window.spMusic = {
      play,
      pause: () => { mk.current?.pause(); },
      resume: () => { void mk.current?.play(); },
      next: () => { void mk.current?.skipToNextItem(); },
      prev: () => { void mk.current?.skipToPreviousItem(); },
      state: () => stRef.current,
    };
    (async () => {
      try {
        const r = await fetch("/api/music/token", { cache: "no-store" });
        if (!r.ok) { publish({ backend: "apple", error: httpErr(r.status, "Apple Music") }); return; }
        const { developerToken } = await r.json();
        const MusicKit = await loadMusicKit();
        if (cancelled) return;
        await MusicKit.configure({ developerToken, app: { name: "Startpage TV", build: "1" } });
        const m = MusicKit.getInstance();
        mk.current = m;
        const on = () => publish();
        for (const ev of ["playbackStateDidChange", "nowPlayingItemDidChange", "authorizationStatusDidChange", "queueItemsDidChange"]) {
          m.addEventListener(ev, on);
        }
        let last = 0;
        m.addEventListener("playbackTimeDidChange", () => {
          const now = Date.now();
          if (now - last > 1000) { last = now; publish(); }
        });
        publish({ backend: "apple", error: null });
      } catch (e) {
        publish({ backend: "apple", error: e instanceof Error ? e.message : "MusicKit failed" });
      }
    })();
    return () => { cancelled = true; };
  };

  const pct = st.duration ? Math.min(100, (st.position / st.duration) * 100) : 0;
  return (
    <main className="tvm">
      <style>{CSS}</style>
      {!st.ready ? (
        <p className="tvm-msg">{st.error ?? "Loading music…"}</p>
      ) : !st.authorized ? (
        <div className="tvm-auth">
          <h1>Apple Music</h1>
          <p>Sign in with your Apple ID to play music on this TV.</p>
          <button autoFocus onClick={() => mk.current?.authorize().then(() => publish()).catch((e: Error) => publish({ error: e.message }))}>
            Sign in to Apple Music
          </button>
          {st.error && <p className="tvm-err">{st.error}</p>}
        </div>
      ) : (
        <div className="tvm-now">
          {st.artwork ? <img src={st.artwork} alt="" className="tvm-art" /> : <div className="tvm-art tvm-art-empty">♪</div>}
          <div className="tvm-meta">
            <h1>{st.title ?? "Nothing playing"}</h1>
            <h2>{[st.artist, st.album].filter(Boolean).join(" — ") || "Ask Aria to play something"}</h2>
            {st.backend === "subsonic" && !st.title && (
              <button className="tvm-shuffle" onClick={() => void window.spMusic?.play("")}>Shuffle my library</button>
            )}
            <div className="tvm-bar"><div style={{ width: `${pct}%` }} /></div>
            <div className="tvm-time">
              <span>{fmt(st.position)}</span>
              <span>{st.playing ? "Playing" : st.state === "paused" ? "Paused" : ""}</span>
              <span>{st.duration ? fmt(st.duration) : ""}</span>
            </div>
            <div className="tvm-ctl">
              <button onClick={() => window.spMusic?.prev()} aria-label="Previous">⏮</button>
              <button autoFocus onClick={() => (st.playing ? window.spMusic?.pause() : window.spMusic?.resume())} aria-label={st.playing ? "Pause" : "Play"}>
                {st.playing ? "⏸" : "▶"}
              </button>
              <button onClick={() => window.spMusic?.next()} aria-label="Next">⏭</button>
            </div>
            {st.error && <p className="tvm-err">{st.error}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

const CSS = `
.tvm{position:fixed;inset:0;background:#05050a;color:#f2f2f7;display:flex;align-items:center;justify-content:center;
  font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;padding:5vh 6vw;box-sizing:border-box;z-index:10}
.tvm-msg{font-size:2.2vw;opacity:.7}
.tvm-auth{text-align:center;max-width:60vw}
.tvm-auth h1{font-size:4vw;margin:0 0 1vw}
.tvm-auth p{font-size:1.8vw;opacity:.75;margin:0 0 3vw}
.tvm button{font:inherit;font-size:1.8vw;color:#fff;background:#fa2d48;border:0;border-radius:1.2vw;padding:1.1vw 2.6vw;cursor:pointer;outline:none}
.tvm button:focus,.tvm button:hover{box-shadow:0 0 0 .35vw #fff}
.tvm-now{display:flex;gap:5vw;align-items:center;width:100%}
.tvm-art{width:32vw;height:32vw;max-height:70vh;max-width:70vh;border-radius:1.5vw;object-fit:cover;box-shadow:0 2vw 6vw rgba(0,0,0,.6);flex:none}
.tvm-art-empty{display:flex;align-items:center;justify-content:center;background:#16161f;font-size:10vw;opacity:.5}
.tvm-meta{flex:1;min-width:0}
.tvm-meta h1{font-size:3.6vw;margin:0 0 .6vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tvm-meta h2{font-size:2vw;font-weight:400;opacity:.7;margin:0 0 3vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tvm-bar{height:.5vw;background:#2a2a35;border-radius:.25vw;overflow:hidden}
.tvm-bar div{height:100%;background:#fa2d48;transition:width 1s linear}
.tvm-time{display:flex;justify-content:space-between;font-size:1.3vw;opacity:.6;margin:.8vw 0 3vw}
.tvm-ctl{display:flex;gap:2vw}
.tvm-ctl button{background:#1d1d27;font-size:2.4vw;width:6vw;height:6vw;padding:0;border-radius:50%}
.tvm-shuffle{margin:0 0 3vw}
.tvm-err{color:#ff8a8a;font-size:1.5vw;margin-top:2vw}
`;
