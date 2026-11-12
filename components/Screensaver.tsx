"use client";

import { useEffect, useRef } from "react";

interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseHue: number;
  hueSpeed: number;
  wobbleOffset: number;
  wobbleSpeed: number;
}

const BG = "#06060f";

function makeBubble(w: number, h: number): Bubble {
  const r = 30 + Math.random() * 70;
  return {
    x: r + Math.random() * (w - r * 2),
    y: r + Math.random() * (h - r * 2),
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    r,
    baseHue: Math.random() * 360,
    hueSpeed: 0.2 + Math.random() * 0.3,
    wobbleOffset: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.01 + Math.random() * 0.02,
  };
}

function bubbleCount(w: number, h: number) {
  return Math.max(8, Math.floor((w * h) / 40000));
}

function drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, t: number) {
  const hue = (b.baseHue + t * b.hueSpeed) % 360;
  const hue2 = (hue + 50) % 360;
  const hue3 = (hue + 110) % 360;
  const r = b.r + Math.sin(t * b.wobbleSpeed + b.wobbleOffset) * 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.clip();

  // Inner body — mostly transparent, slight colour tint
  const body = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
  body.addColorStop(0, "rgba(255,255,255,0)");
  body.addColorStop(0.65, `hsla(${hue}, 60%, 60%, 0.02)`);
  body.addColorStop(0.88, `hsla(${hue2}, 80%, 70%, 0.07)`);
  body.addColorStop(1, `hsla(${hue3}, 100%, 80%, 0.18)`);
  ctx.fillStyle = body;
  ctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);

  // Primary specular highlight — upper-left
  const hx = b.x - r * 0.28;
  const hy = b.y - r * 0.32;
  const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.28);
  spec.addColorStop(0, "rgba(255,255,255,0.75)");
  spec.addColorStop(0.5, "rgba(255,255,255,0.15)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec;
  ctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);

  // Secondary highlight — lower-right
  const h2x = b.x + r * 0.28;
  const h2y = b.y + r * 0.22;
  const spec2 = ctx.createRadialGradient(h2x, h2y, 0, h2x, h2y, r * 0.16);
  spec2.addColorStop(0, "rgba(255,255,255,0.22)");
  spec2.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec2;
  ctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);

  ctx.restore();

  // Iridescent ring
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  const ring = ctx.createLinearGradient(
    b.x - r, b.y - r,
    b.x + r, b.y + r
  );
  ring.addColorStop(0, `hsla(${hue}, 100%, 75%, 0.5)`);
  ring.addColorStop(0.33, `hsla(${hue2}, 100%, 80%, 0.4)`);
  ring.addColorStop(0.66, `hsla(${hue3}, 100%, 75%, 0.45)`);
  ring.addColorStop(1, `hsla(${hue}, 100%, 75%, 0.5)`);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

export default function Screensaver() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const bubblesRef = useRef<Bubble[]>([]);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const prevW = canvas.width || window.innerWidth;
      const prevH = canvas.height || window.innerHeight;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const scaleX = canvas.width / prevW;
      const scaleY = canvas.height / prevH;
      bubblesRef.current.forEach((b) => { b.x *= scaleX; b.y *= scaleY; });
      const target = bubbleCount(canvas.width, canvas.height);
      while (bubblesRef.current.length < target)
        bubblesRef.current.push(makeBubble(canvas.width, canvas.height));
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const { width: w, height: h } = canvas;
      tRef.current += 1;
      const t = tRef.current;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      for (const b of bubblesRef.current) {
        b.x += b.vx;
        b.y += b.vy;
        if (b.x - b.r < 0 || b.x + b.r > w) b.vx *= -1;
        if (b.y - b.r < 0 || b.y + b.r > h) b.vy *= -1;
        b.x = Math.max(b.r, Math.min(w - b.r, b.x));
        b.y = Math.max(b.r, Math.min(h - b.r, b.y));
        drawBubble(ctx, b, t);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full"
      style={{ display: "block", zIndex: 0 }}
    />
  );
}
