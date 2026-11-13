"use client";

// Apple Music on the TV via MusicKit JS v3, inside the TV app's WebView.
// The native app drives it through window.spMusic and hears back through
// window.StartpageTV.onMusicState(json) on every state change.
import { useCallback, useEffect, useRef, useState } from "react";

const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

type MusicState = {
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
  ready: false, authorized: false, playing: false, state: "none",
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

  useEffect(() => {
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
        if (!r.ok) {
          const err = r.status === 423 ? "Enter your PIN first" : r.status === 503 ? "Apple Music isn't set up" : r.status === 401 ? "Sign in first" : `Token error ${r.status}`;
          publish({ error: err });
          return;
        }
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
        publish({ error: null });
      } catch (e) {
        publish({ error: e instanceof Error ? e.message : "MusicKit failed" });
      }
    })();
    return () => { cancelled = true; delete window.spMusic; };
  }, [play, publish]);

  const pct = st.duration ? Math.min(100, (st.position / st.duration) * 100) : 0;
  return (
    <main className="tvm">
      <style>{CSS}</style>
      {!st.ready ? (
        <p className="tvm-msg">{st.error ?? "Loading Apple Music…"}</p>
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
.tvm-err{color:#ff8a8a;font-size:1.5vw;margin-top:2vw}
`;
