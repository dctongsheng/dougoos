import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const markdownPlugins = [remarkGfm, remarkBreaks];

export function MarkdownMessage({ children }: { readonly children: string }) {
  return (
    <div className="markdown-message">
      <ReactMarkdown remarkPlugins={markdownPlugins}>{children}</ReactMarkdown>
    </div>
  );
}
