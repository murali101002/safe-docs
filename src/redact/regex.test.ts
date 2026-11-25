import { describe, expect, it } from 'vitest'
import { detectRegexSpans } from './regex'
import type { RedactionType } from './types'

/**
 * Synthetic PII corpus — every value is fake ("Jane Testpatient",
 * example.com, 555 numbers, MR0000001). The regex layer must find every
 * planted item (100% recall) in each class.
 */

/** Text planted with exactly one PII item per class, plus clean lab text. */
const CORPUS: Array<{ label: string; text: string; type: RedactionType; expected: string }> = [
  {
    label: 'bare SSN',
    text: 'SSN on file 123-45-6789 verified',
    type: 'SSN',
    expected: '123-45-6789',
  },
  {
    label: 'labeled SSN',
    text: 'SSN: 987-65-4321 issued',
    type: 'SSN',
    expected: '987-65-4321',
  },
  {
    label: 'dashed phone',
    text: 'Call 555-123-4567 for results',
    type: 'PHONE',
    expected: '555-123-4567',
  },
  {
    label: 'paren phone',
    text: 'Clinic line (555) 867-5309 is staffed',
    type: 'PHONE',
    expected: '(555) 867-5309',
  },
  {
    label: 'country-code phone',
    text: 'Fax +1 555-234-5678 available',
    type: 'PHONE',
    expected: '+1 555-234-5678',
  },
  {
    label: 'email',
    text: 'Email jane.testpatient@example.com for copies',
    type: 'EMAIL',
    expected: 'jane.testpatient@example.com',
  },
  {
    label: 'DOB MM/DD/YYYY',
    text: 'DOB: 01/15/1960',
    type: 'DOB',
    expected: '01/15/1960',
  },
  {
    label: 'DOB ISO',
    text: 'Date of Birth: 1960-01-15',
    type: 'DOB',
    expected: '1960-01-15',
  },
  {
    label: 'DOB month name',
    text: 'Birth Date: January 15, 1960',
    type: 'DOB',
    expected: 'January 15, 1960',
  },
  {
    label: 'MRN',
    text: 'MRN: MR0000001 on every page',
    type: 'MRN',
    expected: 'MR0000001',
  },
  {
    label: 'Medical Record Number',
    text: 'Medical Record No. 00-4455 confirms identity',
    type: 'MRN',
    expected: '00-4455',
  },
  {
    label: 'member ID',
    text: 'Member ID: XYZ-4455 active through 2027',
    type: 'INSURANCE',
    expected: 'XYZ-4455',
  },
  {
    label: 'policy number',
    text: 'Policy #: A1234567 expired',
    type: 'INSURANCE',
    expected: 'A1234567',
  },
  {
    label: 'subscriber ID',
    text: 'Subscriber ID: SUB-99887 covers dependents',
    type: 'INSURANCE',
    expected: 'SUB-99887',
  },
  {
    label: 'street address',
    text: 'Mail to 123 Main Street, Springfield',
    type: 'ADDRESS',
    expected: '123 Main Street',
  },
  {
    label: 'address with state and zip',
    text: 'Clinic: 45 Oak Avenue, Springfield, IL 62704',
    type: 'ADDRESS',
    expected: '45 Oak Avenue, Springfield, IL 62704',
  },
  {
    label: 'labeled zip',
    text: 'Zip: 62704-1234 matches',
    type: 'ZIP',
    expected: '62704-1234',
  },
  {
    label: 'zip after state',
    text: 'Ships to Peoria, AZ 85345 on request',
    type: 'ZIP',
    expected: '85345',
  },
  {
    label: 'patient line',
    text: 'Patient: Jane Testpatient\nCBC panel follows',
    type: 'NAME',
    expected: 'Jane Testpatient',
  },
]

describe('layer-1 regex recall (must be 100%)', () => {
  for (const item of CORPUS) {
    it(`finds ${item.label}`, () => {
      const spans = detectRegexSpans(item.text)
      const hit = spans.find((s) => item.text.slice(s.start, s.end) === item.expected)
      expect(hit, `expected span for "${item.expected}" in ${JSON.stringify(item.text)}`).toBeDefined()
      expect(hit?.type).toBe(item.type)
    })
  }

  it('finds every planted item in a mixed realistic report', () => {
    const text = [
      'Patient: Jane Testpatient',
      'DOB: 01/15/1960   MRN: MR0000001',
      'Member ID: XYZ-4455   SSN: 123-45-6789',
      'Address: 123 Main Street, Springfield, IL 62704',
      'Phone: 555-123-4567   Email: jane.testpatient@example.com',
      '',
      'Hemoglobin 13.5 g/dL 12.0-15.5',
      'Glucose 92 mg/dL 70-99',
    ].join('\n')
    const spans = detectRegexSpans(text)
    const found = spans.map((s) => text.slice(s.start, s.end))
    const required = [
      'Jane Testpatient',
      '01/15/1960',
      'MR0000001',
      'XYZ-4455',
      '123-45-6789',
      '123 Main Street, Springfield, IL 62704',
      '555-123-4567',
      'jane.testpatient@example.com',
    ]
    for (const needle of required) {
      expect(found, `recall: "${needle}" must be redacted`).toContain(needle)
    }
  })

  it('does not redact clean lab content (precision sample)', () => {
    const text = [
      'COMPLETE BLOOD COUNT',
      'Hemoglobin 13.5 g/dL 12.0-15.5',
      'WBC 5,200 10^3/µL 4,000-11,000',
      'Platelets 250 10^3/µL 150-400',
      'Collected: 03/15/2026',
    ].join('\n')
    const spans = detectRegexSpans(text)
    expect(spans).toEqual([]) // dates stay (trends); nothing else is PII
  })

  it('spans are non-overlapping and sorted', () => {
    const text = 'Patient: Jane Testpatient DOB: 01/15/1960 MRN: MR0000001'
    const spans = detectRegexSpans(text)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
    }
  })
})
