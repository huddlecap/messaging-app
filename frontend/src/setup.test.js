import { describe, it, expect } from 'vitest'

describe('frontend test setup', () => {
  it('runs a trivial test', () => {
    expect(1 + 1).toBe(2)
  })

  it('provides a jsdom environment', () => {
    expect(typeof window).toBe('object')
    expect(typeof document).toBe('object')
  })
})