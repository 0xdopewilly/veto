import type { CSSProperties, ElementType } from "react";

/**
 * Text that rises line by line from behind a mask. Pass `lines` for headlines with chosen
 * breaks, or `text` for a single line. Pure CSS, so server-rendered text never flashes.
 */
export function LineReveal({
  as: Tag = "span",
  lines,
  text,
  delay = 0,
  className,
  style,
  id,
}: {
  as?: ElementType;
  lines?: string[];
  text?: string;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const parts = lines ?? [text ?? ""];
  return (
    <Tag className={className} style={{ ...style, ["--lr-base" as string]: `${delay}ms` }} id={id} aria-label={parts.join(" ")}>
      {parts.map((line, i) => (
        <span key={i} className="lr-line" aria-hidden="true">
          <span className="lr-inner" style={{ ["--lr-i" as string]: i }}>
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}
