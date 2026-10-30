"use client";

import { useActionState, useState } from "react";
import { uploadImportAction } from "@/app/actions";
import { btn, input, label } from "@/components/ui";

/** Phone photos are often 5–12 MB; hosting limits uploads to ~4.5 MB. Resize to ≤2400 px JPEG (~1 MB), plenty for reading handwriting. */
async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 2.5 * 1024 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("resize failed"))), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function ImportUpload({ ocrReady, today }: { ocrReady: boolean; today: string }) {
  const [state, action, pending] = useActionState(uploadImportAction, undefined);
  const [mode, setMode] = useState<"file" | "ocr">("file");
  const [kind, setKind] = useState("sale");
  return (
    <form action={action} className="space-y-3">
      <div role="radiogroup" aria-label="Source" className="grid grid-cols-2 gap-1 rounded-md bg-paper p-1">
        <button type="button" role="radio" aria-checked={mode === "file"} onClick={() => setMode("file")} className={`rounded px-3 py-2 text-sm font-semibold ${mode === "file" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>Excel / CSV file</button>
        <button type="button" role="radio" aria-checked={mode === "ocr"} onClick={() => { setMode("ocr"); if (kind !== "sale" && kind !== "purchase") setKind("sale"); }} className={`rounded px-3 py-2 text-sm font-semibold ${mode === "ocr" ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>Register photo</button>
      </div>
      <input type="hidden" name="mode" value={mode} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="ikind">What are you importing?</label>
          <select id="ikind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            <option value="sale">Sales</option>
            <option value="purchase">Purchases</option>
            {mode === "file" && (<><option value="parties">Parties (with opening balances)</option><option value="products">Products</option><option value="opening_stock">Opening stock</option></>)}
          </select>
        </div>
        {mode === "ocr" && (
          <div>
            <label className={label} htmlFor="idate">Date of these entries</label>
            <input id="idate" type="date" name="date" defaultValue={today} max={today} className={input} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className={label} htmlFor="ifile">{mode === "ocr" ? "Photo of one register page" : "File (.xlsx or .csv)"}</label>
          <input id="ifile" name="file" type="file" required
            onChange={async (e) => {
              const input = e.currentTarget;
              const f = input.files?.[0];
              if (!f || mode !== "ocr") return;
              try {
                const small = await shrinkPhoto(f);
                if (small !== f) {
                  const dt = new DataTransfer();
                  dt.items.add(small);
                  input.files = dt.files;
                }
              } catch {
                /* keep the original; the server reports if it's too large */
              }
            }} accept={mode === "ocr" ? "image/jpeg,image/png,image/webp" : ".csv,.xlsx"} capture={mode === "ocr" ? "environment" : undefined} className={`${input} file:mr-3 file:rounded file:border-0 file:bg-ink-tint file:px-3 file:py-1 file:text-sm file:font-medium file:text-ink`} />
        </div>
      </div>
      {mode === "ocr" && !ocrReady && <p className="rounded-md bg-turmeric-tint px-3 py-2 text-sm text-turmeric">Photo reading needs ANTHROPIC_API_KEY on the server. Excel/CSV import works without it.</p>}
      {mode === "ocr" && <p className="text-xs text-muted">AI reads the page into rows. You check every row against the photo before anything is posted. Struck-through entries are skipped.</p>}
      {state && !state.ok && <p role="alert" className="rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{state.error}</p>}
      <button disabled={pending || (mode === "ocr" && !ocrReady)} className={btn.primary}>{pending ? (mode === "ocr" ? "Reading photo…" : "Reading file…") : "Upload and review"}</button>
    </form>
  );
}
