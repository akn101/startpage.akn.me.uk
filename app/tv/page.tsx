import type { Metadata } from "next";
import TvHome from "./TvHome";

export const metadata: Metadata = { title: "Startpage TV" };
export const dynamic = "force-dynamic";

/** The TV app's home screen for a desktop browser: same cards, rules and PIN flow as the native app. */
export default function TvPage() {
  return <TvHome />;
}
