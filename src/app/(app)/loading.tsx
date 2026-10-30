export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded bg-rule/70" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg bg-rule/50" />)}
      </div>
      <div className="h-72 rounded-lg bg-rule/40" />
    </div>
  );
}
