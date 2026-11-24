import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTextItems, groupRows } from '../../src/pdf/extract'
import {
  parseDocDate,
  parseLabResults,
  parseRowsDetailed,
  type LabResult,
} from '../../src/labs/parseRows'

/**
 * Golden tests: real pdf.js extraction -> groupRows -> parseRows, compared
 * field by field against hand-authored expected results. The expectations
 * come from the fixture specs (scripts/gen-fixtures.ts), never from running
 * the parser itself.
 */

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'labs')

interface ExpectedDoc {
  docDate: string | null
  results: LabResult[]
}

const EXPECTED = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'expected.json'), 'utf8'),
) as Record<string, ExpectedDoc>

const FILES = Object.keys(EXPECTED)

/** Fields compared one by one; the accuracy table reports each. */
const FIELDS = [
  'test',
  'value',
  'unit',
  'refLow',
  'refHigh',
  'refText',
  'flag',
  'page',
] as const

type Field = (typeof FIELDS)[number]

interface Tally {
  correct: number
  total: number
}

function pct(t: Tally): string {
  return t.total === 0 ? 'n/a' : `${(100 * t.correct) / t.total}`
}

async function runFixture(
  file: string,
): Promise<{ parsed: LabResult[]; docDate: string | null }> {
  const bytes = readFileSync(join(FIXTURES_DIR, file))
  const items = await extractTextItems(new Uint8Array(bytes))
  const rows = groupRows(items)
  return { parsed: parseLabResults(rows), docDate: parseDocDate(rows) }
}

describe('lab extraction golden fixtures', () => {
  for (const file of FILES) {
    const expected = EXPECTED[file]

    it(`parses ${file} field by field`, async () => {
      const { parsed, docDate } = await runFixture(file)

      const problems: string[] = []
      if (docDate !== expected.docDate) {
        problems.push(`docDate: expected ${expected.docDate}, got ${docDate}`)
      }
      if (parsed.length !== expected.results.length) {
        problems.push(
          `result count: expected ${expected.results.length}, got ${parsed.length}`,
        )
      }
      for (let i = 0; i < Math.min(parsed.length, expected.results.length); i++) {
        for (const field of FIELDS) {
          const exp = expected.results[i][field]
          const got = parsed[i][field]
          if (!Object.is(got, exp)) {
            problems.push(
              `result ${i} (${expected.results[i].test}) field "${field}": expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`,
            )
          }
        }
      }
      if (problems.length > 0) throw new Error(problems.join('\n'))
    })
  }

  it('prints the accuracy table and requires 100% on value, unit, and flag', async () => {
    const tally = Object.fromEntries(
      FIELDS.map((f) => [f, { correct: 0, total: 0 }]),
    ) as Record<Field, Tally>
    const dateTally = { correct: 0, total: 0 }
    const resultTally = { correct: 0, total: 0 }

    for (const file of FILES) {
      const { parsed, docDate } = await runFixture(file)
      const expected = EXPECTED[file]

      // A result slot counts as correct when the row count matches and all
      // its fields match; extra or missing results penalize every field.
      resultTally.total += expected.results.length
      for (let i = 0; i < expected.results.length; i++) {
        const got = parsed[i]
        if (got === undefined) continue
        resultTally.correct++
        for (const field of FIELDS) {
          tally[field].total++
          if (Object.is(got[field], expected.results[i][field])) tally[field].correct++
        }
      }
      for (let i = expected.results.length; i < parsed.length; i++) {
        for (const field of FIELDS) tally[field].total++
      }

      dateTally.total++
      if (docDate === expected.docDate) dateTally.correct++
    }

    const lines = [
      'Lab extraction accuracy — real pdf.js -> groupRows -> parseRows',
      'field          correct/total   accuracy',
    ]
    for (const field of FIELDS) {
      const t = tally[field]
      lines.push(
        `${field.padEnd(15)}${`${t.correct}/${t.total}`.padEnd(16)}${pct(t)}%`,
      )
    }
    lines.push(
      `${'docDate'.padEnd(15)}${`${dateTally.correct}/${dateTally.total}`.padEnd(16)}${pct(dateTally)}%`,
    )
    lines.push(
      `${'results'.padEnd(15)}${`${resultTally.correct}/${resultTally.total}`.padEnd(16)}${pct(resultTally)}%`,
    )
    console.log('\n' + lines.join('\n') + '\n')

    // Hard requirement from the spec: 100% on value, unit, and flag.
    for (const field of ['value', 'unit', 'flag'] as const) {
      expect(tally[field].correct, `field ${field} must be 100%`).toBe(tally[field].total)
      expect(tally[field].total, `field ${field} must cover fixtures`).toBeGreaterThan(0)
    }
    // The remaining fields are deterministic on synthetic fixtures too.
    for (const field of ['test', 'refLow', 'refHigh', 'refText', 'page'] as const) {
      expect(tally[field].correct, `field ${field} must be 100%`).toBe(tally[field].total)
    }
    expect(dateTally.correct).toBe(dateTally.total)
    expect(resultTally.correct).toBe(resultTally.total)
  })

  it('marks unparseable rows for on-device cleanup instead of guessing', async () => {
    const bytes = readFileSync(join(FIXTURES_DIR, 'messy-rows.pdf'))
    const items = await extractTextItems(new Uint8Array(bytes))
    const detailed = parseRowsDetailed(groupRows(items))
    const skipped = detailed.rowInfo.filter((info) => info.outcome === 'skipped')
    expect(skipped.length).toBe(3)
  })
})
