import { parseBlocks, type Inline } from "@/lib/richtext";

function Inlines({ parts }: { parts: Inline[] }) {
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
                {p.text}
              </a>
            );
          case "mention":
            return (
              <span
                key={i}
                className="rounded px-[3px] font-medium text-link"
                style={{ background: "rgba(93,129,86,.18)" }}
              >
                {p.text}
              </span>
            );
          case "bold":
            return <strong key={i}>{p.text}</strong>;
          default:
            return <span key={i}>{p.text}</span>;
        }
      })}
    </>
  );
}

/** Renders a stored message body (plain text + markdown subset) as paragraphs, headings, lists. */
export function MessageBody({ body, compact = false }: { body: string; compact?: boolean }) {
  const blocks = parseBlocks(body);
  const size = compact ? "text-[15px]" : "text-[16px]";
  return (
    <div className="min-w-0 overflow-hidden">
      {blocks.map((b, i) => {
        if (b.type === "h") {
          return (
            <p key={i} className={`mt-3 mb-2 font-bold ${size}`}>
              {b.text}
            </p>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className={`mb-2 list-disc pl-6 leading-[1.55] ${size}`}>
              {b.items.map((item, j) => (
                <li key={j} className="my-0.5">
                  <Inlines parts={item} />
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
                <Inlines parts={line} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
