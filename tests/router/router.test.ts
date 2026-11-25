import { describe, expect, it } from 'vitest'
import { estimateTokens, isTrendQuestion, routeQuestion } from '../../src/ai/router'
import { ROUTER_DEFAULTS } from '../../src/ai/routerConfig'

const base = {
  docCount: 1,
  isTrend: false,
  contextTokens: 500,
  offline: false,
  onDeviceAvailable: true,
  config: { ...ROUTER_DEFAULTS, cloudEnabled: true },
}

describe('estimateTokens', () => {
  it('counts whitespace words (~0.75 tokens per word)', () => {
    expect(estimateTokens('one two three')).toBe(4)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('isTrendQuestion', () => {
  it('detects trend-shaped questions', () => {
    expect(isTrendQuestion('How has my A1C trend changed over time?')).toBe(true)
    expect(isTrendQuestion('Compare my glucose between January and March')).toBe(true)
    expect(isTrendQuestion('What was my A1C?')).toBe(false)
  })
})

describe('routeQuestion', () => {
  it('offline always means on-device, even for trends (limited)', () => {
    const decision = routeQuestion({ ...base, offline: true, isTrend: true })
    expect(decision.target).toBe('device')
    expect(decision.limited).toBe(true)
    expect(decision.reason).toMatch(/Offline/)
  })

  it('cloud disabled means on-device', () => {
    const decision = routeQuestion({
      ...base,
      config: { ...ROUTER_DEFAULTS, cloudEnabled: false },
      isTrend: true,
    })
    expect(decision.target).toBe('device')
    expect(decision.reason).toMatch(/disabled/i)
  })

  it('on-device unavailable escalates to cloud when enabled and online', () => {
    const decision = routeQuestion({ ...base, onDeviceAvailable: false })
    expect(decision.target).toBe('cloud')
    expect(decision.reason).toMatch(/unavailable/i)
  })

  it('trend questions go to the cloud', () => {
    const decision = routeQuestion({ ...base, isTrend: true })
    expect(decision.target).toBe('cloud')
    expect(decision.reason).toMatch(/trend/i)
  })

  it('multi-document questions go to the cloud', () => {
    const decision = routeQuestion({ ...base, docCount: 2 })
    expect(decision.target).toBe('cloud')
    expect(decision.reason).toMatch(/2 documents/)
  })

  it('oversized context goes to the cloud', () => {
    const decision = routeQuestion({
      ...base,
      contextTokens: ROUTER_DEFAULTS.localMaxTokens + 1,
    })
    expect(decision.target).toBe('cloud')
    expect(decision.reason).toMatch(/local_max_tokens/)
  })

  it('single-doc, right-sized questions stay on-device by default', () => {
    const decision = routeQuestion(base)
    expect(decision.target).toBe('device')
    expect(decision.reason).toMatch(/Single-document/)
    expect(decision.limited).toBeUndefined()
  })

  it('cloud disabled beats every cloud trigger', () => {
    const decision = routeQuestion({
      ...base,
      isTrend: true,
      docCount: 3,
      contextTokens: 9000,
      config: { ...ROUTER_DEFAULTS, cloudEnabled: false },
    })
    expect(decision.target).toBe('device')
    expect(decision.reason).toMatch(/disabled/i)
  })
})
