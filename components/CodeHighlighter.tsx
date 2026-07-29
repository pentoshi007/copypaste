"use client";

import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/**
 * The heavy half of CodeBlock, isolated so bundlers can split it out.
 *
 * `PrismAsyncLight` ships only the highlighter core and loads each language
 * grammar on demand, instead of the ~all-languages bundle that the plain
 * `Prism` export pulls into the first load.
 */
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
