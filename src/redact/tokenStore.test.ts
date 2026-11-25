import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteTokenMap, getTokenMap, saveTokenMap } from './tokenStore'
import type { TokenMap } from './types'

const MAP_A: TokenMap = [{ token: '[NAME_1]', type: 'NAME', value: 'Jane Testpatient' }]
const MAP_B: TokenMap = [{ token: '[SSN_1]', type: 'SSN', value: '123-45-6789' }]

describe('tokenStore (IndexedDB, device-only)', () => {
  beforeEach(async () => {
    await deleteTokenMap('doc-a')
    await deleteTokenMap('doc-b')
  })

  it('saves and loads a token map per document', async () => {
    await saveTokenMap('doc-a', MAP_A)
    expect(await getTokenMap('doc-a')).toEqual(MAP_A)
  })

  it('isolates documents', async () => {
    await saveTokenMap('doc-a', MAP_A)
    await saveTokenMap('doc-b', MAP_B)
    expect(await getTokenMap('doc-a')).toEqual(MAP_A)
    expect(await getTokenMap('doc-b')).toEqual(MAP_B)
  })

  it('overwrites on re-save (updated review)', async () => {
    await saveTokenMap('doc-a', MAP_A)
    await saveTokenMap('doc-a', MAP_B)
    expect(await getTokenMap('doc-a')).toEqual(MAP_B)
  })

  it('returns null for unknown documents and deletes cleanly', async () => {
    expect(await getTokenMap('missing')).toBeNull()
    await saveTokenMap('doc-a', MAP_A)
    await deleteTokenMap('doc-a')
    expect(await getTokenMap('doc-a')).toBeNull()
  })
})
