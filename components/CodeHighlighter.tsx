"use client";

import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const CUSTOM_STYLE = {
  margin: 0,
  borderRadius: 0,
  fontSize: "0.8125rem",
  lineHeight: "1.5rem",
  padding: "1rem",
  background: "transparent",
};

export default function CodeHighlighter({ content, language }: { content: string; language: string }) {
  return (
    <SyntaxHighlighter
      language={language || "plaintext"}
      style={oneDark}
      customStyle={CUSTOM_STYLE}
      wrapLongLines
    >
      {content}
    </SyntaxHighlighter>
  );
}
