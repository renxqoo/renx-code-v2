/**
 * Markdown to plain text conversion.
 * Replaces openclaw/plugin-sdk/text-runtime's stripMarkdown.
 */
/** Strip common markdown formatting to plain text. */
export function stripMarkdown(text) {
    let result = text;
    // Bold/italic
    result = result.replace(/(\*{1,3})(.*?)\1/g, "$2");
    result = result.replace(/(_{1,3})(.*?)\1/g, "$2");
    // Strikethrough
    result = result.replace(/~~(.*?)~~/g, "$1");
    // Headings
    result = result.replace(/^#{1,6}\s+/gm, "");
    // Horizontal rules
    result = result.replace(/^[-*_]{3,}\s*$/gm, "");
    // Blockquotes
    result = result.replace(/^>\s+/gm, "");
    // Inline code
    result = result.replace(/`([^`]+)`/g, "$1");
    // Unordered list markers
    result = result.replace(/^[\s]*[-*+]\s+/gm, "- ");
    // Ordered list markers
    result = result.replace(/^[\s]*\d+\.\s+/gm, "");
    return result.trim();
}
/**
 * Convert markdown-formatted model reply to plain text for Weixin delivery.
 */
export function markdownToPlainText(text) {
    let result = text;
    // Code blocks: strip fences, keep code content
    result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim());
    // Images: remove entirely
    result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    // Links: keep display text only
    result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    // Tables: remove separator rows
    result = result.replace(/^\|[\s:|-]+\|$/gm, "");
    result = result.replace(/^\|(.+)\|$/gm, (_, inner) => inner.split("|").map((cell) => cell.trim()).join("  "));
    result = stripMarkdown(result);
    return result;
}
