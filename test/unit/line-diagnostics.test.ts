import { describe, expect, test } from 'bun:test'
import { createLineDiagnostics } from '../../src/list/line-diagnostics'
import { parseCardLine, type CardLineDiagnostic } from '../../src/card/card-line-grammar'
import { syncMessage } from '../../src/sync/message'

/** The one diagnostic a card line raises (its error, or its only advisory). */
function diagnosticOf(line: string): CardLineDiagnostic {
  const parsed = parseCardLine('deck', line)
  if (!parsed.ok) return parsed
  const [advisory] = parsed.advisories
  if (advisory === undefined) throw new Error(`"${line}" raised no diagnostic`)
  return advisory
}

/**
 * The parse-diagnostic channel every list parser records through: two English
 * string channels (the rewrite gates read `warnings`), the structured card-line
 * diagnostics, and `notices` — every warning and advisory again as a message —
 * which must never disagree with the strings.
 */
describe('createLineDiagnostics', () => {
  test('warn, advise and record fill the strings and the notices together, in order', () => {
    const report = createLineDiagnostics()
    const skipped = report.warn(
      syncMessage('domain.import.text.extraTitle', { line: '# Second Title' }),
    )
    const about = report.advise(
      syncMessage('domain.import.text.aboutLineSkipped', { line: 'Format: commander' }),
    )
    const duplicate = report.record(diagnosticOf('1 Sol Ring [foil] [foil]'), 7)
    const suspect = report.record(diagnosticOf('4 (M10) 146'), 8)

    expect(report.warnings).toEqual([
      'Skipped extra title line: # Second Title',
      'line 7: Duplicate finish token [foil].',
    ])
    expect(report.advisories).toEqual([
      'Skipped About line: Format: commander',
      expect.stringContaining('line 8: Card name still contains a printing token'),
    ])
    // Each method hands back the notice it recorded — the handle a parser marks.
    expect(report.notices).toEqual([skipped, about, duplicate!, suspect!])
    expect(report.notices.map((notice) => notice.severity)).toEqual([
      'warning',
      'advisory',
      'warning',
      'advisory',
    ])
    // Severity by severity, the notices are exactly the strings.
    for (const severity of ['warning', 'advisory'] as const) {
      const strings = severity === 'warning' ? report.warnings : report.advisories
      expect(
        report.notices
          .filter((notice) => notice.severity === severity)
          .map((notice) => notice.message.message),
      ).toEqual([...strings])
    }
    // Keyed where Ritual worded it; the grammar's own text rides keyless.
    expect(skipped.message.messageKey).toBe('domain.import.text.extraTitle')
    expect(duplicate?.message.messageKey).toBeUndefined()
  })

  test('a rewritten export dialect is kept structured only — no string, no notice', () => {
    const report = createLineDiagnostics()
    const rewritten = diagnosticOf('4 Lightning Bolt (M10) 146')
    expect(report.record(rewritten, 3)).toBeUndefined()
    expect(report.warnings).toEqual([])
    expect(report.advisories).toEqual([])
    expect(report.notices).toEqual([])
    expect(report.diagnostics).toEqual([rewritten])
  })
})
