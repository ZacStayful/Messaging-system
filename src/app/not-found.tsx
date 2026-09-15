import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-frame p-6 text-ink">
      <div className="rounded-[14px] border border-line bg-panel p-7 text-center shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        <h1 className="text-[20px] font-bold">We couldn&apos;t find that</h1>
        <p className="mt-2 text-[15px] text-muted">
          The conversation may have been archived or you may not have access to it.
        </p>
        <Link
          href="/dms"
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-brand px-4 text-[15px] font-semibold text-white no-underline"
        >
          Back to messages
        </Link>
      </div>
    </main>
  );
}
