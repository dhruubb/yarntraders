import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The entry may have been moved, or the link is wrong.</p>
        <Link href="/" className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Go to dashboard</Link>
      </div>
    </div>
  );
}
