import { parseBlocks, type Inline } from "@/lib/richtext";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps case-insensitive matches of `query` in <mark>. */
function Highlight({ text, query }: { text: string; query?: string }) {
  const q = query?.trim();
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "ig"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-[#E2A13A] px-px text-[#1E2A1C]">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Inlines({ parts, query }: { parts: Inline[]; query?: string }) {
  return (
    <>
      {parts.map((p, i) => {
        switch (p.type) {
          case "link":
            return (
              <a
                key={i}
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link underline break-all"
              >
                <Highlight text={p.text} query={query} />
              </a>
            );
          case "mention":
            return (
              <span
                key={i}
                className="rounded px-[3px] font-medium text-link"
                style={{ background: "rgba(93,129,86,.18)" }}
                data-mention={p.name}
              >
                @{p.name}
              </span>
            );
          case "bold":
            return (
              <strong key={i}>
                <Highlight text={p.text} query={query} />
              </strong>
            );
          default:
            return (
              <span key={i}>
                <Highlight text={p.text} query={query} />
              </span>
            );
        }
      })}
    </>
  );
}

/** Renders a stored message body (plain text + markdown subset) as paragraphs, headings, lists. */
export function MessageBody({ body, compact = false, query }: { body: string; compact?: boolean; query?: string }) {
  const blocks = parseBlocks(body);
  const size = compact ? "text-[15px]" : "text-[16px]";
  return (
    <div className="min-w-0 overflow-hidden">
      {blocks.map((b, i) => {
        if (b.type === "h") {
          return (
            <p key={i} className={`mt-3 mb-2 font-bold ${size}`}>
              <Highlight text={b.text} query={query} />
            </p>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className={`mb-2 list-disc pl-6 leading-[1.55] ${size}`}>
              {b.items.map((item, j) => (
                <li key={j} className="my-0.5">
                  <Inlines parts={item} query={query} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className={`mb-2 leading-[1.55] ${size}`} style={{ overflowWrap: "anywhere" }}>
            {b.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Inlines parts={line} query={query} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
