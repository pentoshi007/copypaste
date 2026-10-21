"use client";

import { memo, useMemo, type ReactNode } from "react";
import { parseInline, type InlineNode } from "@/lib/editor/inline";

function render(nodes: InlineNode[], prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] text-rose-600 dark:bg-neutral-800 dark:text-rose-400"
          >
            {node.text}
          </code>
        );
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {render(node.children, `${key}-`)}
          </strong>
        );
      case "italic":
        return <em key={key}>{render(node.children, `${key}-`)}</em>;
      case "strike":
        return (
          <s key={key} className="opacity-70">
            {render(node.children, `${key}-`)}
          </s>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(event) => event.stopPropagation()}
            className="break-all text-blue-600 underline decoration-blue-600/30 underline-offset-2 hover:decoration-blue-600 dark:text-blue-400"
          >
            {render(node.children, `${key}-`)}
          </a>
        );
    }
  });
}

function InlineText({ text }: { text: string }) {
  const nodes = useMemo(() => render(parseInline(text), ""), [text]);
  return <>{nodes}</>;
}

export default memo(InlineText);
