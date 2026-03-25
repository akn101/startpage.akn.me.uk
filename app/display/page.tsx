import dynamic from "next/dynamic";

const DisplayShell = dynamic(
  () => import("@/components/display/DisplayShell"),
  { ssr: false }
);

export default function DisplayPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <DisplayShell />
    </div>
  );
}
