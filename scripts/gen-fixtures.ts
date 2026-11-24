/**
 * Generates the 12 synthetic lab-report PDFs used by tests/labs/golden.test.ts
 * plus the hand-authored expected results (tests/fixtures/labs/expected.json).
 *
 * All patient data is synthetic ("Jane Testpatient", MRN 0000001-style) —
 * no real PII is ever generated. Run with: npm run gen:fixtures
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/* ------------------------------------------------------------------ */
/* Spec types                                                          */
/* ------------------------------------------------------------------ */

/** The exact LabResult a data row must parse into (hand-authored contract). */
interface Expect {
  test: string
  value: number | null
  unit: string | null
  refLow: number | null
  refHigh: number | null
  refText: string | null
  flag: 'H' | 'L' | 'N' | null
}

interface DataRow {
  kind: 'data'
  test: string
  /** The value cell exactly as printed (e.g. "12.5", "13.5 H", "5,200 /µL"). */
  valueText: string
  unitCell: string | null
  flagCell: string | null // letter drawn in the flag column ('' = blank)
  refCell: string | null
  expect: Expect
  wrapBefore?: string // name fragment on its own line above the value row
  wrapAfter?: string // continuation line below the value row
}

interface TextRow {
  kind: 'text'
  /** Cells drawn left-to-right at the name/value/… column positions. */
  cells: string[]
}

interface SectionRow {
  kind: 'section'
  text: string
}

type RowSpec = DataRow | TextRow | SectionRow

/** Column x positions for one table column group. */
interface Columns {
  name: number
  value: number
  unit?: number
  flag?: number
  ref?: number
}

interface FixtureSpec {
  file: string
  /** Lines drawn above the table (title, patient, MRN, collection date). */
  meta: string[]
  columns: Columns
  /** Header cells drawn at the column positions (null = skip position). */
  header: Array<string | null>
  rows: RowSpec[]
  /** Two results sharing one visual line (multi-column layouts). */
  pairs?: Array<[RowSpec, RowSpec]>
  /** Second column group for multi-column layouts (x positions + header). */
  secondGroup?: { columns: Columns; header: Array<string | null> }
  landscape?: boolean
  docDate: string | null
}

/* ------------------------------------------------------------------ */
/* Fixture definitions                                                 */
/* ------------------------------------------------------------------ */

/** Single-column layout used by most fixtures. */
const COLS: Columns = { name: 72, value: 320, unit: 400, flag: 448, ref: 480 }
/** Layout without a flag column. */
const COLS_NO_FLAG: Columns = { name: 72, value: 320, unit: 400, ref: 450 }
/** Layout without unit or flag column (units are part of the value cell). */
const COLS_NO_UNIT: Columns = { name: 72, value: 320, ref: 450 }

function data(
  test: string,
  valueText: string,
  unitCell: string | null,
  flagCell: string | null,
  refCell: string | null,
  expect: Expect,
  extras: { wrapBefore?: string; wrapAfter?: string } = {},
): DataRow {
  return { kind: 'data', test, valueText, unitCell, flagCell, refCell, expect, ...extras }
}

function exp(
  test: string,
  value: number | null,
  unit: string | null,
  refLow: number | null,
  refHigh: number | null,
  refText: string | null,
  flag: 'H' | 'L' | 'N' | null,
): Expect {
  return { test, value, unit, refLow, refHigh, refText, flag }
}

const REPORT_TITLE = 'LABORATORY REPORT'
const PATIENT = 'Patient: Jane Testpatient'
const MRN = 'MRN: MR0000001'

const FIXTURES: FixtureSpec[] = [
  {
    file: 'cbc-basic.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS,
    header: ['Test', 'Result', 'Units', 'Flag', 'Reference Range'],
    docDate: null,
    rows: [
      data('WBC', '12.5', '10^3/µL', 'H', '4.0-11.0',
        exp('WBC', 12.5, '10^3/µL', 4, 11, '4.0-11.0', 'H')),
      data('RBC', '4.7', '10^6/µL', '', '4.5-5.9',
        exp('RBC', 4.7, '10^6/µL', 4.5, 5.9, '4.5-5.9', 'N')),
      data('Hemoglobin', '13.5', 'g/dL', 'N', '12.0-15.5',
        exp('Hemoglobin', 13.5, 'g/dL', 12, 15.5, '12.0-15.5', 'N')),
      data('Hematocrit', '40.0', '%', '', '36.0-46.0',
        exp('Hematocrit', 40, '%', 36, 46, '36.0-46.0', 'N')),
      data('MCV', '88', 'fL', '', '80-100',
        exp('MCV', 88, 'fL', 80, 100, '80-100', 'N')),
      data('MCH', '29', 'pg', '', '27-33',
        exp('MCH', 29, 'pg', 27, 33, '27-33', 'N')),
      data('MCHC', '33', 'g/dL', '', '32-36',
        exp('MCHC', 33, 'g/dL', 32, 36, '32-36', 'N')),
      data('RDW', '12.5', '%', '', '11.5-14.5',
        exp('RDW', 12.5, '%', 11.5, 14.5, '11.5-14.5', 'N')),
    ],
  },
  {
    file: 'cbc-wrapped.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: null,
    rows: [
      data('Cell Count', '5.2', '10^3/µL', null, '4.0-11.0',
        exp('White Blood Cell Count', 5.2, '10^3/µL', 4, 11, '4.0-11.0', 'N'),
        { wrapBefore: 'White Blood' }),
      data('Neutrophils', '2.1', '10^3/µL', null, '1.5-7.5',
        exp('Neutrophils (Absolute)', 2.1, '10^3/µL', 1.5, 7.5, '1.5-7.5', 'N'),
        { wrapAfter: '(Absolute)' }),
      data('Lymphocytes', '1.4', '10^3/µL', null, '1.0-4.8',
        exp('Lymphocytes', 1.4, '10^3/µL', 1, 4.8, '1.0-4.8', 'N')),
      data('Platelets', '250', '10^3/µL', null, '150-400',
        exp('Platelets', 250, '10^3/µL', 150, 400, '150-400', 'N')),
    ],
  },
  {
    file: 'cmp-no-flags.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: null,
    rows: [
      data('Glucose (Fasting)', '105', 'mg/dL', null, '70-99',
        exp('Glucose (Fasting)', 105, 'mg/dL', 70, 99, '70-99', 'H')),
      data('Creatinine', '1.3', 'mg/dL', null, '0.6-1.2',
        exp('Creatinine', 1.3, 'mg/dL', 0.6, 1.2, '0.6-1.2', 'H')),
      data('eGFR (CKD-EPI)', '58', 'mL/min', null, '>60',
        exp('eGFR (CKD-EPI)', 58, 'mL/min', 60, null, '>60', 'L')),
      data('Sodium', '139', 'mEq/L', null, '136-145',
        exp('Sodium', 139, 'mEq/L', 136, 145, '136-145', 'N')),
      data('Potassium', '4.2', 'mEq/L', null, '3.5-5.1',
        exp('Potassium', 4.2, 'mEq/L', 3.5, 5.1, '3.5-5.1', 'N')),
      data('Chloride', '101', 'mEq/L', null, '98-107',
        exp('Chloride', 101, 'mEq/L', 98, 107, '98-107', 'N')),
      data('CO2 (Bicarbonate)', '24', 'mEq/L', null, '22-29',
        exp('CO2 (Bicarbonate)', 24, 'mEq/L', 22, 29, '22-29', 'N')),
      data('Calcium', '9.4', 'mg/dL', null, '8.5-10.2',
        exp('Calcium', 9.4, 'mg/dL', 8.5, 10.2, '8.5-10.2', 'N')),
      data('ALT (SGPT)', '62', 'U/L', null, '7-56',
        exp('ALT (SGPT)', 62, 'U/L', 7, 56, '7-56', 'H')),
      data('AST (SGOT)', '30', 'U/L', null, '10-40',
        exp('AST (SGOT)', 30, 'U/L', 10, 40, '10-40', 'N')),
    ],
  },
  {
    file: 'lipid.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: null,
    rows: [
      data('Total Cholesterol', '185', 'mg/dL', null, '<200',
        exp('Total Cholesterol', 185, 'mg/dL', null, 200, '<200', 'N')),
      data('Triglycerides', '130', 'mg/dL', null, '<150',
        exp('Triglycerides', 130, 'mg/dL', null, 150, '<150', 'N')),
      data('HDL Cholesterol', '52', 'mg/dL', null, '>40',
        exp('HDL Cholesterol', 52, 'mg/dL', 40, null, '>40', 'N')),
      data('LDL Cholesterol (calc)', '110', 'mg/dL', null, '<100',
        exp('LDL Cholesterol (calc)', 110, 'mg/dL', null, 100, '<100', 'H')),
      data('Chol/HDL Ratio', '3.6', null, null, null,
        exp('Chol/HDL Ratio', 3.6, null, null, null, null, null)),
    ],
  },
  {
    file: 'a1c.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: null,
    rows: [
      data('Hemoglobin A1c', '6.7', '%', null, '4.0-5.6',
        exp('Hemoglobin A1c', 6.7, '%', 4, 5.6, '4.0-5.6', 'H')),
      data('Est. Avg Glucose (eAG)', '146', 'mg/dL', null, '<140',
        exp('Est. Avg Glucose (eAG)', 146, 'mg/dL', null, 140, '<140', 'H')),
    ],
  },
  {
    file: 'tsh.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: null,
    rows: [
      // Flag letter drawn inside the value cell: "0.12 L".
      data('TSH', '0.12 L', 'µU/mL', null, '0.45-4.50',
        exp('TSH', 0.12, 'µU/mL', 0.45, 4.5, '0.45-4.50', 'L')),
      data('Free T4', '1.1', 'ng/dL', null, '0.8-1.8',
        exp('Free T4', 1.1, 'ng/dL', 0.8, 1.8, '0.8-1.8', 'N')),
    ],
  },
  {
    file: 'multi-column.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: { name: 60, value: 280, unit: 350, ref: 420 },
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    secondGroup: {
      columns: { name: 480, value: 620, unit: 690, ref: 740 },
      header: ['Test', 'Result', 'Units', 'Reference Range'],
    },
    landscape: true,
    docDate: null,
    rows: [],
    pairs: [
      [data('Glucose (Fasting)', '92', 'mg/dL', null, '70-99',
        exp('Glucose (Fasting)', 92, 'mg/dL', 70, 99, '70-99', 'N')),
       data('Creatinine', '0.9', 'mg/dL', null, '0.6-1.2',
        exp('Creatinine', 0.9, 'mg/dL', 0.6, 1.2, '0.6-1.2', 'N'))],
      [data('Sodium', '140', 'mEq/L', null, '136-145',
        exp('Sodium', 140, 'mEq/L', 136, 145, '136-145', 'N')),
       data('Potassium', '4.0', 'mEq/L', null, '3.5-5.1',
        exp('Potassium', 4, 'mEq/L', 3.5, 5.1, '3.5-5.1', 'N'))],
      [data('Chloride', '102', 'mEq/L', null, '98-107',
        exp('Chloride', 102, 'mEq/L', 98, 107, '98-107', 'N')),
       data('Calcium', '9.5', 'mg/dL', null, '8.5-10.2',
        exp('Calcium', 9.5, 'mg/dL', 8.5, 10.2, '8.5-10.2', 'N'))],
      [data('ALT (SGPT)', '28', 'U/L', null, '7-56',
        exp('ALT (SGPT)', 28, 'U/L', 7, 56, '7-56', 'N')),
       data('AST (SGOT)', '24', 'U/L', null, '10-40',
        exp('AST (SGOT)', 24, 'U/L', 10, 40, '10-40', 'N'))],
    ],
  },
  {
    file: 'flags-inline.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: null,
    rows: [
      // Explicit letter wins over the range: 13.5 is within 12.0-15.5 but "H".
      data('Hemoglobin', '13.5 H', 'g/dL', null, '12.0-15.5',
        exp('Hemoglobin', 13.5, 'g/dL', 12, 15.5, '12.0-15.5', 'H')),
      data('Potassium', '4.1 L', 'mEq/L', null, '3.5-5.1',
        exp('Potassium', 4.1, 'mEq/L', 3.5, 5.1, '3.5-5.1', 'L')),
      data('Glucose (Fasting)', '89', 'mg/dL', null, '70-99',
        exp('Glucose (Fasting)', 89, 'mg/dL', 70, 99, '70-99', 'N')),
      data('TSH', '0.35 N', 'µU/mL', null, '0.45-4.50',
        exp('TSH', 0.35, 'µU/mL', 0.45, 4.5, '0.45-4.50', 'N')),
    ],
  },
  {
    file: 'trend-jan.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN, 'Collected: 2026-01-15'],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: '2026-01-15',
    rows: [
      data('Glucose (Fasting)', '98', 'mg/dL', null, '70-99',
        exp('Glucose (Fasting)', 98, 'mg/dL', 70, 99, '70-99', 'N')),
      data('Hemoglobin A1c', '5.9', '%', null, '4.0-5.6',
        exp('Hemoglobin A1c', 5.9, '%', 4, 5.6, '4.0-5.6', 'H')),
      data('LDL Cholesterol (calc)', '112', 'mg/dL', null, '<100',
        exp('LDL Cholesterol (calc)', 112, 'mg/dL', null, 100, '<100', 'H')),
    ],
  },
  {
    file: 'trend-mar.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN, 'Collected: 03/15/2026'],
    columns: COLS_NO_FLAG,
    header: ['Test', 'Result', 'Units', 'Reference Range'],
    docDate: '2026-03-15',
    rows: [
      data('Glucose (Fasting)', '112', 'mg/dL', null, '70-99',
        exp('Glucose (Fasting)', 112, 'mg/dL', 70, 99, '70-99', 'H')),
      data('Hemoglobin A1c', '6.3', '%', null, '4.0-5.6',
        exp('Hemoglobin A1c', 6.3, '%', 4, 5.6, '4.0-5.6', 'H')),
      data('LDL Cholesterol (calc)', '95', 'mg/dL', null, '<100',
        exp('LDL Cholesterol (calc)', 95, 'mg/dL', null, 100, '<100', 'N')),
    ],
  },
  {
    file: 'mixed-formats.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS_NO_UNIT,
    header: ['Test', 'Result', 'Reference Range'],
    docDate: null,
    rows: [
      // Units and commas live inside the value cell.
      data('WBC', '5,200 /µL', null, null, '4,000-11,000',
        exp('WBC', 5200, '/µL', 4000, 11000, '4,000-11,000', 'N')),
      data('Hemoglobin', '13.5 g/dL', null, null, '12.0-15.5',
        exp('Hemoglobin', 13.5, 'g/dL', 12, 15.5, '12.0-15.5', 'N')),
      data('Platelets', '250 10^3/µL', null, null, '150-400',
        exp('Platelets', 250, '10^3/µL', 150, 400, '150-400', 'N')),
      data('Triglycerides', '1,180 mg/dL', null, null, '<150',
        exp('Triglycerides', 1180, 'mg/dL', null, 150, '<150', 'H')),
    ],
  },
  {
    file: 'messy-rows.pdf',
    meta: [REPORT_TITLE, PATIENT, MRN],
    columns: COLS,
    header: ['Test', 'Result', 'Units', 'Flag', 'Reference Range'],
    docDate: null,
    rows: [
      { kind: 'section', text: 'URINALYSIS' },
      // Word "values" — deterministic parser skips these; the on-device
      // cleanup step (src/labs/nanoCleanup.ts) converts them.
      { kind: 'text', cells: ['Color', 'Yellow'] },
      { kind: 'text', cells: ['Appearance', 'Clear'] },
      { kind: 'section', text: 'CHEMISTRY' },
      data('Potassium', '4.2', 'mEq/L', '', '3.5-5.1',
        exp('Potassium', 4.2, 'mEq/L', 3.5, 5.1, '3.5-5.1', 'N')),
      data('Sodium', '139', 'mEq/L', '', '136-145',
        exp('Sodium', 139, 'mEq/L', 136, 145, '136-145', 'N')),
      // Ratio written as "19:1" is not a clean value — skipped, not guessed.
      { kind: 'text', cells: ['BUN/Creatinine Ratio', '19:1'] },
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

const ROW_GAP = 20

/** Vertical layout, adjusted for portrait (612pt tall) vs landscape pages. */
function layout(spec: FixtureSpec): { metaStart: number; metaStep: number; headerY: number; firstRowY: number } {
  return spec.landscape
    ? { metaStart: 590, metaStep: 16, headerY: 520, firstRowY: 500 }
    : { metaStart: 750, metaStep: 18, headerY: 660, firstRowY: 640 }
}

async function drawFixture(spec: FixtureSpec, outDir: string): Promise<void> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage(spec.landscape ? [792, 612] : [612, 792])
  const size = spec.landscape ? 8 : 10

  const { metaStart, metaStep, headerY, firstRowY } = layout(spec)

  // Metadata lines above the table.
  let y = metaStart
  for (const line of spec.meta) {
    page.drawText(line, { x: 72, y, size, font })
    y -= metaStep
  }

  // Column headers.
  drawCells(page, font, size, spec.columns, spec.header, headerY)
  if (spec.secondGroup) drawCells(page, font, size, spec.secondGroup.columns, spec.secondGroup.header, headerY)

  // Rows. Multi-column fixtures use `pairs` (two results share a line):
  // every group of a line is drawn on the SAME baseline, and the cursor
  // advances once per line (driven by the first group's return value).
  const groups: RowSpec[][] = spec.pairs
    ? spec.pairs.map((pair) => [...pair])
    : spec.rows.map((row) => [row])
  let cursor = firstRowY
  for (const line of groups) {
    let nextY = cursor
    for (let g = 0; g < line.length; g++) {
      const columns = g === 0 ? spec.columns : spec.secondGroup?.columns
      if (!columns) throw new Error('missing column group')
      const returned = drawRow(page, font, size, columns, line[g], cursor, g > 0)
      if (g === 0) nextY = returned // only the first group advances the cursor
    }
    cursor = nextY
  }

  const bytes = await doc.save()
  writeFileSync(join(outDir, spec.file), bytes)
}

/** Draw cells at the column positions on one baseline; returns nothing. */
function drawCells(
  page: PDFPage,
  font: PDFFont,
  size: number,
  columns: Columns,
  cells: Array<string | null>,
  y: number,
): void {
  const positions = [
    columns.name,
    columns.value,
    columns.unit ?? -1,
    columns.flag ?? -1,
    columns.ref ?? -1,
  ]
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i]
    const x = positions[i]
    if (text !== null && text !== '' && x >= 0) page.drawText(text, { x, y, size, font })
  }
}

/**
 * Draw one row spec, handling wrapped-name lines, and return the y for the
 * next row (always ROW_GAP below the lowest line drawn).
 */
function drawRow(
  page: PDFPage,
  font: PDFFont,
  size: number,
  columns: Columns,
  spec: RowSpec,
  y: number,
  suppressWrapLines = false,
): number {
  if (spec.kind === 'section') {
    page.drawText(spec.text, { x: columns.name, y, size, font })
    return y - ROW_GAP
  }
  if (spec.kind === 'text') {
    const positions = [
      columns.name,
      columns.value,
      columns.unit ?? -1,
      columns.flag ?? -1,
      columns.ref ?? -1,
    ]
    spec.cells.forEach((text, i) => {
      const x = positions[i]
      if (text !== '' && x >= 0) page.drawText(text, { x, y, size, font })
    })
    return y - ROW_GAP
  }

  // Data row, with optional wrapped name lines.
  let mainY = y
  if (spec.wrapBefore !== undefined && !suppressWrapLines) {
    page.drawText(spec.wrapBefore, { x: columns.name, y, size, font })
    mainY = y - ROW_GAP
  }
  const cells: Array<string | null> = [
    spec.test,
    spec.valueText,
    spec.unitCell,
    spec.flagCell ?? '',
    spec.refCell,
  ]
  drawCells(page, font, size, columns, cells, mainY)
  if (spec.wrapAfter !== undefined && !suppressWrapLines) {
    page.drawText(spec.wrapAfter, { x: columns.name, y: mainY - ROW_GAP, size, font })
    return mainY - ROW_GAP * 2
  }
  return mainY - ROW_GAP
}

/* ------------------------------------------------------------------ */
/* Expected results                                                    */
/* ------------------------------------------------------------------ */

interface ExpectedResult extends Expect {
  page: number
}

interface ExpectedDoc {
  docDate: string | null
  results: ExpectedResult[]
}

function buildExpected(spec: FixtureSpec): ExpectedDoc {
  const all: RowSpec[] = spec.pairs ? spec.pairs.flat() : spec.rows
  const dataRows = all.filter((r): r is DataRow => r.kind === 'data')
  return {
    docDate: spec.docDate,
    results: dataRows.map((r) => ({ ...r.expect, page: 1 })),
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const outDir = join(import.meta.dirname, '..', 'tests', 'fixtures', 'labs')
mkdirSync(outDir, { recursive: true })

const expected: Record<string, ExpectedDoc> = {}
for (const spec of FIXTURES) {
  await drawFixture(spec, outDir)
  expected[spec.file] = buildExpected(spec)
  console.log(`wrote ${spec.file}`)
}

writeFileSync(join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n')
console.log(`wrote expected.json (${FIXTURES.length} fixtures)`)
