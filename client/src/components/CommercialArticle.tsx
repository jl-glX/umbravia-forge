import { Fragment, type ReactNode } from "react";

type ArticleBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "separator" };

function createHeadingId(text: string, occurrences: Map<string, number>) {
  const base =
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "seccion";
  const occurrence = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}

function parseArticle(source: string): ArticleBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ArticleBlock[] = [];
  const headingOccurrences = new Map<string, number>();
  let index = 0;

  const isBlockStart = (line: string) =>
    /^#{1,3} /.test(line) ||
    line === "---" ||
    line.startsWith("> ") ||
    line.startsWith("- ");

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const text = heading[2];
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text,
        id: createHeadingId(text, headingOccurrences),
      });
      index += 1;
      continue;
    }

    if (line === "---") {
      blocks.push({ kind: "separator" });
      index += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoteLine = lines[index]?.trim() ?? "";
        if (!quoteLine.startsWith("> ")) break;
        quoteLines.push(quoteLine.slice(2));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoteLines.join(" ") });
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index]?.trim() ?? "";
        if (!item.startsWith("- ")) break;
        items.push(item.slice(2));
        index += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index]?.trim() ?? "";
      if (!nextLine || isBlockStart(nextLine)) break;
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${part}-${index}`} className="font-bold text-brand-night">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    ),
  );
}

const headingClasses = {
  1: "mt-16 text-3xl font-black tracking-tight text-brand-night sm:text-4xl",
  2: "mt-12 text-2xl font-black tracking-tight text-brand-night sm:text-3xl",
  3: "mt-9 text-xl font-bold text-brand-slate sm:text-2xl",
} as const;

export function CommercialArticle({ source }: { source: string }) {
  const blocks = parseArticle(source);

  return (
    <article
      lang="es"
      aria-label="Presentación detallada de Umbravia Forge"
      className="mt-16 rounded-[2rem] border border-white/80 bg-white/90 px-6 py-10 shadow-xl shadow-slate-900/5 backdrop-blur-sm sm:px-10 sm:py-14 lg:px-14"
    >
      <div className="mx-auto max-w-4xl">
        {blocks.map((block, index) => {
          if (block.kind === "heading") {
            const Heading =
              block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
            return (
              <Heading
                id={block.id}
                key={`${block.id}-${index}`}
                className={`${headingClasses[block.level]} scroll-mt-8 first:mt-0`}
              >
                {renderInline(block.text)}
              </Heading>
            );
          }
          if (block.kind === "paragraph") {
            return (
              <p
                key={`paragraph-${index}`}
                className="mt-5 text-base leading-8 text-slate-600 sm:text-lg"
              >
                {renderInline(block.text)}
              </p>
            );
          }
          if (block.kind === "quote") {
            return (
              <blockquote
                key={`quote-${index}`}
                className="my-7 rounded-r-2xl border-l-4 border-brand-ember bg-orange-50/70 px-5 py-4 text-lg font-semibold leading-8 text-brand-slate"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          }
          if (block.kind === "list") {
            return (
              <ul
                key={`list-${index}`}
                className="mt-5 grid gap-2 text-base leading-7 text-slate-600 sm:grid-cols-2 sm:text-lg"
              >
                {block.items.map((item, itemIndex) => (
                  <li
                    key={`${item}-${itemIndex}`}
                    className="flex items-start gap-3 rounded-xl bg-slate-50/80 px-4 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-ember"
                    />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <hr
              key={`separator-${index}`}
              className="my-12 border-0 border-t border-slate-200"
            />
          );
        })}
      </div>
    </article>
  );
}
