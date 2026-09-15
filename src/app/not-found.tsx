import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sage p-6 text-[#1E2A1C]">
      <div className="rounded-[14px] bg-white p-7 text-center shadow-[0_12px_40px_rgba(30,42,28,0.12)]">
        <h1 className="text-[20px] font-bold">We couldn&apos;t find that</h1>
        <p className="mt-2 text-[15px] text-[#3E5A3A]">
          The conversation may have been archived or you may not have access to it.
        </p>
        <Link
          href="/dms"
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-[#5D8156] px-4 text-[15px] font-semibold text-white no-underline"
        >
          Back to messages
        </Link>
      </div>
    </main>
  );
}
