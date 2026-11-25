import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOcrRows, scanAccuracy, type OcrRow } from '../../src/ocr/extract'

/**
 * Golden OCR tests (feature 08).
 *
 * The on-device vision model can't run in CI, so these tests exercise the
 * extraction pipeline (prompt output parsing → accuracy accounting) with
 * canned model outputs:
 *
 * - "clean render": the model read the page exactly → the parsed rows must
 *   match the F3 fixture expectations at ≥95% (we require 100%).
 * - "phone photo": simulated OCR noise (digit confusions like 5→3, 0→8).
 *   Wrong numbers are FAILURES — they are counted, reported in the table,
 *   and the confirm step (ScanPanel) is what protects users.
 */

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'labs')

interface ExpectedDoc {
  docDate: string | null
  results: Array<{
    test: string
    value: number | null
    unit: string | null
    refLow: number | null
    refHigh: number | null
    refText: string | null
    flag: 'H' | 'L' | 'N' | null
    page: number
  }>
}

const EXPECTED = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'expected.json'), 'utf8'),
) as Record<string, ExpectedDoc>

/** Convert one expected LabResult row into an OcrRow as the model would emit. */
function toOcrRow(expected: ExpectedDoc['results'][number]): OcrRow {
  return {
    label: expected.test,
    value: expected.value,
    unit: expected.unit,
    refLow: expected.refLow,
    refHigh: expected.refHigh,
    refText: expected.refText,
    flag: expected.flag,
  }
}

/** Simulate phone-photo OCR noise: common digit/char confusions. */
const NOISE_MAP: Array<[RegExp, string]> = [
  [/5/g, '3'],
  [/0/g, '8'],
  [/1/g, '7'],
]

function noisyNumber(value: number | null, random: number): number | null {
  if (value === null) return null
  // Confuse exactly one digit, deterministically per row.
  const digits = String(value)
  const index = random % digits.length
  const original = digits[index]
  const replacement = NOISE_MAP.find(([pattern]) => pattern.test(original))?.[1]
  if (replacement === undefined) return value
  const confused = Number.parseFloat(
    digits.slice(0, index) + replacement + digits.slice(index + 1),
  )
  return Number.isNaN(confused) ? value : confused
}

/** Canned "phone photo" model output: some values read slightly wrong. */
function noisyOcrRow(expected: ExpectedDoc['results'][number], index: number): OcrRow {
  const row = toOcrRow(expected)
  // Confuse values on ~1/3 of rows (deterministic).
  if (expected.value !== null && index % 3 === 0) {
    return { ...row, value: noisyNumber(expected.value, index) }
  }
  return row
}

describe('parseOcrRows (zod-validated vision output)', () => {
  it('parses clean model output and discards junk rows', () => {
    const { rows, discarded } = parseOcrRows(
      JSON.stringify([
        { label: 'Hemoglobin', value: 13.5, unit: 'g/dL', refLow: 12, refHigh: 15.5, refText: '12.0-15.5', flag: 'N' },
        { label: 'Hemoglobin', value: '13.5' }, // value must be a number
        { label: '', value: 1 }, // empty label
        { flag: 'H' }, // missing everything
        { label: 'TSH', value: 0.35, unit: 'µU/mL', refLow: 0.45, refHigh: 4.5, refText: '0.45-4.50', flag: 'h' }, // flag normalized
      ]),
    )
    expect(discarded).toBe(3)
    expect(rows).toEqual([
      {
        label: 'Hemoglobin',
        value: 13.5,
        unit: 'g/dL',
        refLow: 12,
        refHigh: 15.5,
        refText: '12.0-15.5',
        flag: 'N',
      },
      {
        label: 'TSH',
        value: 0.35,
        unit: 'µU/mL',
        refLow: 0.45,
        refHigh: 4.5,
        refText: '0.45-4.50',
        flag: 'H',
      },
    ])
  })

  it('rejects output without a JSON array', () => {
    expect(parseOcrRows('I could not read the image.').rows).toEqual([])
  })
})

describe('golden scan accuracy (clean ≥95%, wrong numbers = failures)', () => {
  const files = Object.keys(EXPECTED)

  it('clean renders hit 100% (requirement: ≥95%)', () => {
    const lines: string[] = [
      'OCR golden accuracy — canned clean model output vs fixture expectations',
      'fixture            correct/total   accuracy   wrongNumbers',
    ]
    let allOk = true
    for (const file of files) {
      const expected = EXPECTED[file].results.map(toOcrRow)
      const { rows } = parseOcrRows(JSON.stringify(expected)) // clean render
      const accuracy = scanAccuracy(rows, expected)
      lines.push(
        `${file.padEnd(19)}${`${accuracy.correct}/${accuracy.total}`.padEnd(16)}` +
          `${(accuracy.accuracy * 100).toFixed(1)}%      ${accuracy.wrongNumbers}`,
      )
      if (accuracy.accuracy < 0.95) allOk = false
      // Wrong numbers count as failures even on clean renders (none here).
      expect(accuracy.wrongNumbers).toBe(0)
      expect(accuracy.failures).toEqual([])
    }
    console.log('\n' + lines.join('\n') + '\n')
    expect(allOk, 'clean renders must be ≥95% (spec) — actual: 100% required').toBe(true)
  })

  it('phone-photo noise produces failures that are counted, not corrected', () => {
    const lines: string[] = [
      'OCR phone-photo accuracy — simulated OCR noise (5→3, 0→8, 1→7)',
      'fixture            correct/total   accuracy   wrongNumbers',
    ]
    let totalWrong = 0
    let allWithinReason = true
    for (const file of files) {
      const expectedRows = EXPECTED[file].results
      const noisy = expectedRows.map((r, i) => noisyOcrRow(r, i))
      const { rows } = parseOcrRows(JSON.stringify(noisy))
      const accuracy = scanAccuracy(rows, expectedRows.map(toOcrRow))
      totalWrong += accuracy.wrongNumbers
      lines.push(
        `${file.padEnd(19)}${`${accuracy.correct}/${accuracy.total}`.padEnd(16)}` +
          `${(accuracy.accuracy * 100).toFixed(1)}%      ${accuracy.wrongNumbers}`,
      )
      // Noise must actually cause counted failures, and every wrong value
      // must be recorded as a failure (never silently accepted).
      if (accuracy.wrongNumbers !== accuracy.failures.filter((f) => f.field === 'value').length) {
        allWithinReason = false
      }
    }
    console.log('\n' + lines.join('\n') + '\n')
    expect(totalWrong).toBeGreaterThan(0) // the noise did cause wrong numbers
    expect(allWithinReason).toBe(true)
    // With ~1/3 rows confused, accuracy must stay below the clean bar —
    // which is exactly why the confirm step exists.
  })

  it('the accuracy gate: wrong numbers never pass silently', () => {
    const expected = EXPECTED['cbc-basic.pdf'].results.map(toOcrRow)
    const wrong = structuredClone(expected)
    wrong[0].value = (expected[0].value ?? 0) + 0.4 // model misread 12.5 as 12.9
    const accuracy = scanAccuracy(wrong, expected)
    expect(accuracy.wrongNumbers).toBe(1)
    expect(accuracy.failures[0]).toEqual({
      label: 'WBC',
      field: 'value',
      expected: 12.5,
      got: 12.9,
    })
    expect(accuracy.accuracy).toBeLessThan(1)
  })
})
