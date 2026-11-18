import type { Metadata } from "next";
import MusicPlayer from "./MusicPlayer";

export const metadata: Metadata = { title: "Music" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <MusicPlayer />;
}
