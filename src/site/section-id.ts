/**
 * The DOM id of a card section's heading anchor, from its section key.
 *
 * Injective, so two sections can never share an id: ASCII letters, digits and
 * `-` stand for themselves, and every other code point — `_` included, which is
 * what makes the escape unambiguous — becomes `_<hex>_`. A key in any script
 * (`category:ドロー`, `tags:ramp, staple`) keeps its own id.
 */
export function sectionId(key: string): string {
  let id = 'section-'
  for (const char of key) {
    id += /[A-Za-z0-9-]/.test(char) ? char : `_${char.codePointAt(0)!.toString(16)}_`
  }
  return id
}
