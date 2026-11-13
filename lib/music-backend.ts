import { musicConfigured } from "@/lib/apple-music";
import { subsonicConfigured } from "@/lib/subsonic";

export type MusicBackend = "apple" | "subsonic" | null;

/** Apple Music when its key is set, else a Subsonic server, else nothing. */
export function activeMusicBackend(): MusicBackend {
  if (musicConfigured()) return "apple";
  if (subsonicConfigured()) return "subsonic";
  return null;
}
