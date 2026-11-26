/**
 * Escape text for an HTML element's content or a double-quoted attribute: the
 * five characters that can end either, so no interpolated value can open a
 * tag, close an attribute, or start an entity.
 *
 * A leaf with no imports, shared by the site's HTML shell and the MCP OAuth
 * consent page.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
