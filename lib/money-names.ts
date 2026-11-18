// Pure name cleaners for bank / card data. Bank feeds hand us payees like
// "WEIXIN*Meituan platfor", "MT263060421000010085553" (a card reference, the
// merchant is in the notes), "774031 83489760" (sort code + account) or
// "LOAN       07NOV26,100000001855250723". These turn them into something a
// person can read on a TV across the room. No I/O; safe on client and server.

// Payment processors that prefix the real merchant: "WEIXIN*Meituan", "SQ *Cafe".
const PROCESSOR = /^(?:weixin|wechat|wechatpay|alipay|paypal|pp|sumup|sq|zettle|iz|izettle|crv|kpay|pas|sp|tst|paddle\.net|google|gpay|klar|lsp|ptz)\s*\*\s*/i;
// Words that mean "no name here".
const EMPTY = /^(?:no reference|ref(?:erence)?|unknown|n\/?a|visa purchase|card purchase|payment|transfer)$/i;
const TRAILING_STOP = /\s+(?:to|at|via|ref|on|for|from)$/i;

const hasCjk = (s: string) => /[　-鿿＀-￯]/.test(s);

function titleCase(s: string): string {
  // Only re-case shouting: leave "TfL", "McDonald's", "iCloud" alone.
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(/&\-.'])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Strip reference codes, long digit runs, dates and processor noise. May return "". */
function scrub(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^visa (?:purchase|credit)\s+/i, "");
  s = s.replace(PROCESSOR, "");
  s = s.replace(/\*\s*[A-Z0-9]*\d[A-Z0-9]*\b/gi, "");        // "Prime*BI84H65B4" -> "Prime"
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "");                // ISO dates
  s = s.replace(/\b\d{1,2}[A-Z]{3}\d{2,4}\b/gi, "");          // 07NOV26, 04NOV2026
  s = s.replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/gi, ""); // MT2630604... refs
  s = s.replace(/[,;:#-]?\s*\d[\d\s]{4,}\d\b/g, "");          // sort codes, account and ref numbers
  s = s.replace(/[-#]\d+\b/g, "");                            // "SAVETHECHANGE-9760"
  s = s.replace(/\(\s*[^)]*$/, "");                           // dangling "(Batte"
  s = s.replace(/\b(?:GBR|GB|UK|USA|US|HKG|CHN|IRL|LONDON)\s*$/i, "");
  s = s.replace(/[\s,;:*\-·]+$/g, "").replace(/^[\s,;:*\-·]+/g, "");
  for (let i = 0; i < 2; i++) s = s.replace(TRAILING_STOP, "");
  s = s.replace(/\s+/g, " ").trim();
  // "A Kabir A Kabir" style duplicates
  const half = s.split(" ");
  if (half.length % 2 === 0 && half.length >= 2) {
    const a = half.slice(0, half.length / 2).join(" "), b = half.slice(half.length / 2).join(" ");
    if (a.toLowerCase() === b.toLowerCase()) s = a;
  }
  if (!/[A-Za-z　-鿿]/.test(s) || EMPTY.test(s) || s.length < 2) return "";
  return s;
}

/** Notes from card feeds are fixed-width: "COSTA COFFEE 43010881  LONDON   GBR". Keep the first column. */
function fromNotes(notes: string): string {
  if (hasCjk(notes) && notes.includes("·")) return ""; // WeChat export notes: order receipts, not names
  const first = notes.split(/\s{2,}| · /)[0] ?? "";
  return scrub(first);
}

/**
 * A readable merchant name. Falls back to the notes (where card feeds hide the
 * merchant), then the category, then "Unknown".
 */
export function cleanPayee(payee: string | null | undefined, notes?: string | null, category?: string | null): string {
  const p = scrub(payee ?? "");
  if (p) return titleCase(p).slice(0, 60);
  const n = notes ? fromNotes(notes) : "";
  if (n) return titleCase(n).slice(0, 60);
  if (category && !/^uncategori[sz]ed$/i.test(category)) return category;
  return "Unknown";
}

/**
 * Account label: masks card/account numbers to their last four
 * ("489396XXXXXX3383" -> "Card ·· 3383", "070976 XXXX2651" -> "Account ·· 2651")
 * and re-cases shouting ("GLOBAL MONEY ACCOUNT" -> "Global Money Account").
 */
export function cleanAccountName(name: string, type = ""): string {
  const s = name.replace(/\s+/g, " ").trim();
  const m = s.match(/^[\d\s]*[X*•·]{3,}\s*(\d{3,4})$/i) ?? s.match(/^\d[\d\s]{8,}(\d{4})$/);
  if (m) return `${/credit/i.test(type) ? "Card" : "Account"} ·· ${m[1]}`;
  return titleCase(s.replace(/[X*•]{4,}(\d{4})\b/gi, "·· $1"));
}

/** Institution label without the "Personal" suffix banks add: "HSBC Personal" -> "HSBC". */
export function cleanInstitution(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*[-–]?\s*(?:personal|business)\s*$/i, "").replace(/\s+/g, " ").trim();
}
