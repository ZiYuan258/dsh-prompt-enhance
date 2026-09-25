import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, effectiveSystemPrompt, resolveConfig } from '../src/config'
import { DEFAULT_SYSTEM_PROMPT } from '../src/prompts'

describe('resolveConfig', () => {
  it('passes a paired provider/model override', () => {
    const resolved = resolveConfig({ ...DEFAULT_CONFIG, provider: 'zhipu', model: 'glm-5.3' })
    expect(resolved.provider).toBe('zhipu')
    expect(resolved.model).toBe('glm-5.3')
  })

  it('passes an empty pair (session-follow mode)', () => {
    expect(() => resolveConfig({ ...DEFAULT_CONFIG })).not.toThrow()
  })

  it('rejects a half-filled pair', () => {
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, provider: 'zhipu' })).toThrow(/成对/)
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, model: 'glm-5.3' })).toThrow(/成对/)
  })

  it('rejects blank strings in the pair', () => {
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, provider: ' ', model: 'glm' })).toThrow(/非空/)
  })

  it('runs deep runtime validation', () => {
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, temperature: Number.NaN })).toThrow(/temperature/)
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, maxInputChars: 4096.9 })).toThrow(/maxInputChars/)
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, timeoutMs: -1 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, enabled: 'yes' as never })).toThrow(/enabled/)
  })

  it('stores provider/model trimmed', () => {
    const resolved = resolveConfig({ ...DEFAULT_CONFIG, provider: ' zhipu ', model: ' glm ' })
    expect(resolved.provider).toBe('zhipu')
    expect(resolved.model).toBe('glm')
  })

  it('defaults an absent or malformed strategyMode to replace-default', () => {
    expect(resolveConfig({ ...DEFAULT_CONFIG }).strategyMode).toBe('replace-default')
    expect(resolveConfig({ ...DEFAULT_CONFIG, strategyMode: 'bogus' as never }).strategyMode).toBe('replace-default')
  })

  it('keeps an explicit extend-default', () => {
    expect(resolveConfig({ ...DEFAULT_CONFIG, strategyMode: 'extend-default' }).strategyMode).toBe('extend-default')
  })

  it('strips unknown keys left over from older versions', () => {
    const legacy = { ...DEFAULT_CONFIG, legacySetting: 'old-value' } as typeof DEFAULT_CONFIG & Record<string, unknown>
    const resolved = resolveConfig(legacy)
    expect(resolved).not.toHaveProperty('legacySetting')
    expect(resolved.enabled).toBe(DEFAULT_CONFIG.enabled)
    expect(Object.keys(resolved).sort()).toEqual([
      'contextAware', 'contextMaxChars', 'contextMaxMessages', 'enabled',
      'maxConcurrent', 'maxInputChars', 'maxOutputTokens', 'model',
      'provider', 'rateLimitPerMinute', 'reasoningEffort',
      'shortcut', 'strategyMode', 'streaming', 'systemPrompt', 'temperature', 'timeoutMs',
    ])
  })

  // Regression: the field decides the bill (measured 252 vs 2897 output tokens
  // on deepseek-flash), so an unrecognized stored value must not reach the model
  // call — it degrades to the shipped cheap default.
  it('defaults the reasoning effort to the cheapest shipped choice', () => {
    expect(resolveConfig({ ...DEFAULT_CONFIG }).reasoningEffort).toBe('off')
    const legacy = { ...DEFAULT_CONFIG, reasoningEffort: 'turbo' } as unknown as typeof DEFAULT_CONFIG
    expect(resolveConfig(legacy).reasoningEffort).toBe('off')
    const missing = { ...DEFAULT_CONFIG } as Partial<typeof DEFAULT_CONFIG>
    delete missing.reasoningEffort
    expect(resolveConfig(missing as typeof DEFAULT_CONFIG).reasoningEffort).toBe('off')
    expect(resolveConfig({ ...DEFAULT_CONFIG, reasoningEffort: 'inherit' }).reasoningEffort).toBe('inherit')
  })

  it('defaults the streaming and context window to their documented values', () => {
    const resolved = resolveConfig({ ...DEFAULT_CONFIG })
    expect(resolved.streaming).toBe(true)
    expect(resolved.contextAware).toBe(true)
    expect(resolved.contextMaxMessages).toBe(8)
    expect(resolved.contextMaxChars).toBe(4000)
  })

  it('tolerates missing/absent streaming and context flags on older sections', () => {
    const partial = { ...DEFAULT_CONFIG } as Partial<typeof DEFAULT_CONFIG> & Record<string, unknown>
    delete partial.streaming
    delete partial.contextAware
    const resolved = resolveConfig(partial as typeof DEFAULT_CONFIG)
    expect(resolved.streaming).toBe(true)
    expect(resolved.contextAware).toBe(true)
  })

  // Every schema field is `.volatile()` — without that, `dsh-settings` has no
  // form to render and the Settings page stays empty. The loader then hands the
  // plugin `Volatile<T>` references (objects with `get()`), so resolveConfig must
  // flatten them or every numeric read below would compare against an object.
  describe('volatile references', () => {
    /** Minimal stand-in for the harness's `Volatile<T>` reference. */
    const volatile = <T>(value: T): { get: () => T } => ({ get: () => value })

    it('unwraps a fully volatile config section', () => {
      const wrapped = Object.fromEntries(
        Object.entries(DEFAULT_CONFIG).map(([key, value]) => [key, volatile(value)]),
      ) as unknown as typeof DEFAULT_CONFIG
      expect(resolveConfig(wrapped)).toEqual(DEFAULT_CONFIG)
    })

    // A reference object is always truthy, so an unwrapped `false` would sail
    // past the boolean guard and leave the plugin running while the user
    // believes it is switched off.
    it('honors a volatile false on the master switch', () => {
      const wrapped = Object.fromEntries(
        Object.entries(DEFAULT_CONFIG).map(([key, value]) => [key, volatile(key === 'enabled' ? false : value)]),
      ) as unknown as typeof DEFAULT_CONFIG
      expect(resolveConfig(wrapped).enabled).toBe(false)
    })

    it('still rejects a non-boolean switch', () => {
      const wrapped = { ...DEFAULT_CONFIG, enabled: volatile('yes') } as unknown as typeof DEFAULT_CONFIG
      expect(() => resolveConfig(wrapped)).toThrow(/enabled/)
    })
  })

  it('accepts a zero-width context window (context disabled by budget)', () => {
    const resolved = resolveConfig({ ...DEFAULT_CONFIG, contextMaxMessages: 0, contextMaxChars: 0 })
    expect(resolved.contextMaxMessages).toBe(0)
    expect(resolved.contextMaxChars).toBe(0)
  })

  it('rejects an out-of-range context window', () => {
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, contextMaxMessages: 99 })).toThrow(/contextMaxMessages/)
    expect(() => resolveConfig({ ...DEFAULT_CONFIG, contextMaxChars: -1 })).toThrow(/contextMaxChars/)
  })
})

describe('effectiveSystemPrompt', () => {
  it('uses the built-in strategy when the override is blank', () => {
    expect(effectiveSystemPrompt({ ...DEFAULT_CONFIG, systemPrompt: '' }, DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(effectiveSystemPrompt({ ...DEFAULT_CONFIG, systemPrompt: '  \n' }, DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('uses the configured override verbatim in the default (replace) mode', () => {
    expect(effectiveSystemPrompt({ ...DEFAULT_CONFIG, systemPrompt: 'You are terse.' }, DEFAULT_SYSTEM_PROMPT)).toBe('You are terse.')
  })

  it('appends the override after the built-in strategy in extend mode', () => {
    const prompt = effectiveSystemPrompt({ ...DEFAULT_CONFIG, systemPrompt: 'Always answer in bullet points.', strategyMode: 'extend-default' }, DEFAULT_SYSTEM_PROMPT)
    expect(prompt.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true)
    expect(prompt).toContain('Always answer in bullet points.')
  })

  it('falls back to the built-in strategy when the override is blank in either mode', () => {
    expect(effectiveSystemPrompt({ ...DEFAULT_CONFIG, strategyMode: 'extend-default' }, DEFAULT_SYSTEM_PROMPT)).toBe(DEFAULT_SYSTEM_PROMPT)
  })
})
