import { z } from 'zod'

/**
 * Layer 2: on-device Gemini Nano finds person names and street addresses
 * that the deterministic regex layer cannot catch.
 *
 * Privacy: the raw document text is sent ONLY to the on-device model
 * (generateOnDevice -> InferenceMode.ONLY_ON_DEVICE; the SDK cannot fall
 * back to the cloud and the call refuses cloud-reported responses). The
 * model returns a JSON list of exact strings to redact; anything failing
 * zod validation is discarded, and findings are matched back into the
 * original text locally.
 */

const NanoFindingSchema = z.object({
  text: z.string().trim().min(2).max(60),
  type: z.enum(['NAME', 'ADDRESS']),
})

export interface NanoFinding {
  text: string
  type: 'NAME' | 'ADDRESS'
}

const MAX_FINDINGS = 30

const PROMPT_HEADER = [
  'You find personal information that still needs redacting in a medical',
  'document. Return ONLY a JSON array — no prose, no markdown fences.',
  'Each item: {"text": "<exact string from the document>", "type": "NAME" | "ADDRESS"}',
  'Find person names (patient, doctor, family, guarantor) and street',
  'addresses. Use the exact spelling from the document. One item per',
  'unique string. Ignore: test names, lab values, dates, IDs, phone',
  'numbers, emails (those are handled elsewhere). Return [] if none.',
].join('\n')

/** Pull the JSON array out of a model reply (tolerates markdown fences). */
export function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array in on-device output')
  }
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * Ask the on-device model for redaction candidates. Throws if the on-device
 * model is unavailable; invalid items are discarded (never guessed).
 */
export async function nanoFindings(
  text: string,
  generate?: (prompt: string) => Promise<{ text: string }>,
): Promise<NanoFinding[]> {
  const run =
    generate ??
    (async (prompt: string) => {
      const { generateOnDevice } = await import('../ai/hybrid')
      return generateOnDevice(prompt)
    })
  const trimmed = text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text
  const { text: reply } = await run(`${PROMPT_HEADER}\n\nDocument:\n${trimmed}`)
  const parsed = extractJsonArray(reply)
  if (!Array.isArray(parsed)) return []

  const findings: NanoFinding[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    const checked = NanoFindingSchema.safeParse(item)
    if (!checked.success) continue // discard bad output
    const finding = checked.data
    // Names must contain letters; drop echoes of values or lone numbers.
    if (!/[A-Za-z]{2}/.test(finding.text)) continue
    if (seen.has(finding.text.toLowerCase())) continue
    seen.add(finding.text.toLowerCase())
    findings.push(finding)
    if (findings.length >= MAX_FINDINGS) break
  }
  return findings
}
