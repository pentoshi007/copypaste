"use client";

import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function CodeHighlighter({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  return (
    <SyntaxHighlighter
      language={language || "plaintext"}
      style={oneDark}
      customStyle={{
        margin: 0,
        borderRadius: 0,
        fontSize: "0.8125rem",
        padding: "1rem",
        background: "#282c34",
      }}
      wrapLongLines
    >
      {content}
    </SyntaxHighlighter>
  );
}
