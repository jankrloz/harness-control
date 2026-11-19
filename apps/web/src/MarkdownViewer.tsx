import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewerProps {
  readonly content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="md-prose">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
