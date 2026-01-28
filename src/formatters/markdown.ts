import { convert } from "@vakra-dev/supermarkdown";

/**
 * Convert HTML to Markdown
 *
 * Simple conversion without any headers, metadata, or formatting wrappers.
 * Returns clean markdown content ready for LLM consumption.
 *
 * Uses supermarkdown (Rust-based) for high-performance conversion.
 */
export function htmlToMarkdown(html: string): string {
  try {
    return convert(html, {
      headingStyle: "atx",
      bulletMarker: "-",
      codeFence: "`",
      linkStyle: "inline",
    });
  } catch (error) {
    console.warn("Error converting HTML to Markdown:", error);
    // Fallback: extract text content
    return html.replace(/<[^>]*>/g, "").trim();
  }
}

/**
 * Alias for htmlToMarkdown (backward compatibility)
 */
export const formatToMarkdown = htmlToMarkdown;
