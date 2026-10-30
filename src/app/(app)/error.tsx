"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-madder/30 bg-madder-tint p-5 text-sm text-madder">
      <h2 className="font-semibold">This page couldn&rsquo;t load</h2>
      <p className="mt-1">Nothing was saved or changed. Try again; if it keeps happening, note this code for support: {error.digest ?? "—"}</p>
      <button onClick={reset} className="mt-3 rounded-md bg-madder px-3 py-1.5 font-semibold text-white">Try again</button>
    </div>
  );
}
