import type { GlyphKind } from "./tv-logic";

// Weather glyphs drawn the same way as the native Glyph.java, in a 100x100 box.
const SUN = "#EADFC4", CLOUD = "#B4B1CB", DROP = "#C4B5FD", SNOW = "#E8E6F5", BOLT = "#E3C58C";

function Cloud({ base, fill = CLOUD }: { base: number; fill?: string }) {
  return (
    <g fill={fill}>
      <circle cx={36} cy={base - 6} r={14} />
      <circle cx={54} cy={base - 14} r={19} />
      <circle cx={70} cy={base - 4} r={12} />
      <rect x={20} y={base - 8} width={62} height={16} rx={8} />
    </g>
  );
}

function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return <line key={i} x1={cx + Math.cos(a) * r * 1.45} y1={cy + Math.sin(a) * r * 1.45} x2={cx + Math.cos(a) * r * 1.9} y2={cy + Math.sin(a) * r * 1.9} />;
  });
  return (
    <g stroke={SUN} strokeWidth={4} strokeLinecap="round" fill={SUN}>
      <circle cx={cx} cy={cy} r={r} stroke="none" />
      {rays}
    </g>
  );
}

export default function Glyph({ kind, size = 40 }: { kind: GlyphKind; size?: number }) {
  const base = 62;
  let body: React.ReactNode;
  switch (kind) {
    case "clear":
      body = <Sun cx={50} cy={50} r={20} />;
      break;
    case "partly":
      body = <><Sun cx={38} cy={36} r={15} /><Cloud base={base + 8} /></>;
      break;
    case "cloud":
      body = <Cloud base={base} />;
      break;
    case "fog":
      body = (
        <g stroke={CLOUD} strokeWidth={5} strokeLinecap="round">
          <line x1={22} y1={38} x2={78} y2={38} /><line x1={16} y1={54} x2={84} y2={54} /><line x1={26} y1={70} x2={74} y2={70} />
        </g>
      );
      break;
    case "rain":
      body = (
        <>
          <Cloud base={base - 10} />
          <g stroke={DROP} strokeWidth={4} strokeLinecap="round">
            <line x1={38} y1={66} x2={34} y2={80} /><line x1={52} y1={66} x2={48} y2={80} /><line x1={66} y1={66} x2={62} y2={80} />
          </g>
        </>
      );
      break;
    case "snow":
      body = (
        <>
          <Cloud base={base - 10} />
          <g fill={SNOW}><circle cx={36} cy={74} r={4} /><circle cx={52} cy={80} r={4} /><circle cx={68} cy={74} r={4} /></g>
        </>
      );
      break;
    default:
      body = (
        <>
          <Cloud base={base - 10} />
          <path d="M54 60 L42 78 L52 78 L46 94 L64 72 L54 72 L60 60 Z" fill={BOLT} />
        </>
      );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
