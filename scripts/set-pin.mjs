#!/usr/bin/env node
// Prompts for a PIN (hidden) and prints ONLY its PBKDF2 hash to stdout, so it
// can be piped straight into Vercel without the PIN or hash ever being shown:
//   node scripts/set-pin.mjs | vercel env add STARTPAGE_PIN_HASH production
// Same format as lib/lock.ts hashPin(): pbkdf2-sha256$<iter>$<salt>$<hash>
import { webcrypto as crypto } from "node:crypto";

const ITERATIONS = 210_000;
const b64u = (b) => Buffer.from(b).toString("base64url");

function ask(prompt) {
  return new Promise((resolve) => {
    const tty = process.stdin;
    if (!tty.isTTY) { console.error("Run this in a terminal."); process.exit(1); }
    process.stderr.write(prompt);
    tty.setRawMode(true); tty.resume(); tty.setEncoding("utf8");
    let s = "";
    const on = (ch) => {
      if (ch === "\u0003") process.exit(130);
      if (ch === "\r" || ch === "\n") { tty.setRawMode(false); tty.pause(); tty.off("data", on); process.stderr.write("\n"); resolve(s); return; }
      if (ch === "\u007f") { s = s.slice(0, -1); return; }
      if (/^\d$/.test(ch)) { s += ch; process.stderr.write("•"); }
    };
    tty.on("data", on);
  });
}

const pin = await ask("New PIN (6–12 digits): ");
if (!/^\d{6,12}$/.test(pin)) { console.error("PIN must be 6–12 digits."); process.exit(1); }
if ((await ask("Again: ")) !== pin) { console.error("PINs differ."); process.exit(1); }
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
process.stdout.write(`pbkdf2-sha256$${ITERATIONS}$${b64u(salt)}$${b64u(new Uint8Array(bits))}`);
