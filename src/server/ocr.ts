/**
 * Optional AI reading of handwritten register photos. Output is ALWAYS staged for human review;
 * nothing is posted from here.
 */
import { AppError } from "./errors";

export type OcrLine = { party: string; product: string; bags: number | null; rate: number | null; register_amount: number | null; struck_through: boolean; confidence: "high" | "medium" | "low"; note?: string };

export const OCR_PROMPT = (kind: "sale" | "purchase") => `You are reading a photo of a handwritten ${kind} register from an Indian yarn trading business.

Layout of each entry:
- A party (customer/supplier) name on its own line, often underlined, sometimes with a tick or arrow mark.
- Below it, one or more item lines written as: <count> <brand/mill> <bags> [× <rate>], e.g. "30 Amrut 40 × 1258", "47 VPN 200", "58 Silverspring 48".
- An amount in Indian format (no commas, e.g. 503200) written in the left column next to the party or the item line.
- Struck-through entries are corrections.

Return ONLY JSON in this exact shape, with one object per item line (repeat the party name on each of its lines):
{"lines":[{"party":"Khalid B.R","product":"30 Amrut","bags":40,"rate":1258,"register_amount":503200,"struck_through":false,"confidence":"high","note":""}]}

Rules:
- product = count + brand exactly as written (e.g. "47 VPN", "60 Bhavani").
- rate = null if no "× rate" is written. register_amount = null if not readable.
- If an amount applies to a whole party block, put it on that party's first line.
- struck_through = true if the line or amount is crossed out.
- confidence = "low" for any digit you are unsure of, and explain in note.
- Do not invent entries. Skip page numbers and margin numbers.`;

export async function readRegisterPhoto(image: Buffer, mediaType: string, kind: "sale" | "purchase"): Promise<OcrLine[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError("Register reading is not set up: add ANTHROPIC_API_KEY to the server environment.");
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) throw new AppError("Upload a JPG, PNG or WEBP photo");
  if (image.length > 5 * 1024 * 1024) throw new AppError("Photo is larger than 5 MB. Take it at a lower resolution.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } }, { type: "text", text: OCR_PROMPT(kind) }] }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`The reading service returned ${res.status}. ${res.status === 401 ? "Check ANTHROPIC_API_KEY." : body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  return parseOcrText(text);
}

export function parseOcrText(text: string): OcrLine[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new AppError("Couldn't read any entries from this photo. Try a clearer, straight photo of one page.");
  let parsed: { lines?: unknown[] };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AppError("The photo reading came back in an unexpected format. Try again.");
  }
  const toNum = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return (parsed.lines ?? [])
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l) => ({
      party: String(l.party ?? "").trim(),
      product: String(l.product ?? "").trim(),
      bags: toNum(l.bags),
      rate: toNum(l.rate),
      register_amount: toNum(l.register_amount),
      struck_through: Boolean(l.struck_through),
      confidence: (["high", "medium", "low"].includes(String(l.confidence)) ? l.confidence : "low") as OcrLine["confidence"],
      note: l.note ? String(l.note) : undefined,
    }))
    .filter((l) => l.party || l.product);
}
