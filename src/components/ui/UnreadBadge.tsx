export function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={`flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-white px-1.5 text-[13px] font-bold text-[#3E5A3A] ${className}`}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
