import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG } from '../src/config'
import { defaultRouteOf, sessionRouteOf } from '../src/orchestrate'

function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (key: string) => services[key] } as never
}

describe('route resolution helpers', () => {
  it('reads the harness default model from the dedicated service and trims it', () => {
    const ctx = fakeCtx({ agentDefaultModel: { currentSelection: () => ({ provider: ' zhipu ', model: ' glm ' }) } })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'zhipu', model: 'glm' })
  })

  // Regression for the 0.1.7-rc.1 failure: `settings.get` no longer exists, and
  // the unguarded `settings.get('agent-default-model')` call threw
  // `ctx.get(...)?.get is not a function`, failing EVERY enhancement that had no
  // session route. A settings service exposing only the current methods must
  // resolve the route (via describe) or degrade — never throw.
  it('resolves through settings.describe when the legacy get reader is gone', () => {
    const settings = {
      describe: () => [
        { ns: 'include:prompt-enhance', value: { enabled: true } },
        { ns: 'include:agent-default-model', value: { provider: 'deepseek-official', model: 'deepseek-flash' } },
      ],
    }
    expect(defaultRouteOf(fakeCtx({ settings }))).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
  })

  it('never throws when the settings service has no section reader at all', () => {
    const settings = {
      configure: () => () => {},
      prepareDocument: async () => '',
      describe: () => [],
      update: async () => {},
      replace: async () => {},
      mutate: async () => {},
    }
    expect(() => defaultRouteOf(fakeCtx({ settings }))).not.toThrow()
    expect(defaultRouteOf(fakeCtx({ settings }))).toBeUndefined()
  })

  it('still accepts the legacy settings.get section reader defensively', () => {
    const ctx = fakeCtx({ settings: { get: (ns: string) => (ns === 'agent-default-model' ? { provider: ' zhipu ', model: ' glm ' } : undefined) } })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'zhipu', model: 'glm' })
  })

  it('prefers the dedicated service over the legacy readers', () => {
    const ctx = fakeCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'svc', model: 'm-svc' }) },
      settings: { get: () => ({ provider: 'legacy', model: 'm-legacy' }) },
    })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'svc', model: 'm-svc' })
  })

  it('falls back to the legacy reader when the service yields no usable route', () => {
    const ctx = fakeCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'svc', model: '' }) },
      settings: { get: () => ({ provider: 'legacy', model: 'm-legacy' }) },
    })
    expect(defaultRouteOf(ctx)).toEqual({ provider: 'legacy', model: 'm-legacy' })
  })

  it('degrades when a reader throws instead of failing the request', () => {
    const ctx = fakeCtx({
      agentDefaultModel: { currentSelection: () => { throw new Error('boom') } },
      settings: { describe: () => { throw new Error('boom') } },
    })
    expect(() => defaultRouteOf(ctx)).not.toThrow()
    expect(defaultRouteOf(ctx)).toBeUndefined()
  })

  it('ignores malformed default-model sections', () => {
    expect(defaultRouteOf(fakeCtx({ settings: { get: () => ({ provider: 'x', model: '' }) } }))).toBeUndefined()
    expect(defaultRouteOf(fakeCtx({ settings: { get: () => null } }))).toBeUndefined()
    expect(defaultRouteOf(fakeCtx({}))).toBeUndefined()
  })

  // Regression: `Session.requestHeader` is a method in both 0.1.1-rc.2 and
  // 0.1.2-alpha.3. The previous mock shaped it as a plain property, so the test
  // passed against something the runtime never produces while the real call
  // silently returned undefined.
  it('reads the session request route when a session id is given', () => {
    const ctx = fakeCtx({
      sessions: {
        get: (id: string) => (id === 's1' ? { requestHeader: () => ({ config: { provider: ' p1 ', model: ' m1 ' } }) } : undefined),
      },
    })
    expect(sessionRouteOf(ctx, 's1')).toEqual({ provider: 'p1', model: 'm1' })
    expect(sessionRouteOf(ctx, 'missing')).toBeUndefined()
    expect(sessionRouteOf(ctx, undefined)).toBeUndefined()
    expect(sessionRouteOf(ctx, '')).toBeUndefined()
  })

  it('tolerates a header method that returns nothing', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => undefined }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  // Regression: a throwing `requestHeader()` (frozen session object, future
  // signature change) must degrade to the default route instead of failing
  // the whole enhance request.
  it('degrades when the header method throws', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => { throw new Error('boom') } }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  it('still accepts the property shape defensively', () => {
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: { config: { provider: 'p2', model: 'm2' } } }) } })
    expect(sessionRouteOf(ctx, 's1')).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('resolves nothing without a sessions service or a partial section', () => {
    expect(sessionRouteOf(fakeCtx({}), 's1')).toBeUndefined()
    const ctx = fakeCtx({ sessions: { get: () => ({ requestHeader: () => ({ config: { provider: 'p', model: '' } }) }) } })
    expect(sessionRouteOf(ctx, 's1')).toBeUndefined()
  })

  it('resolves nothing when the harness has no default model either', () => {
    expect(defaultRouteOf(fakeCtx({}))).toBeUndefined()
  })

  it('keeps the defaults constant in sync', () => {
    expect(DEFAULT_CONFIG.maxConcurrent).toBe(2)
    expect(DEFAULT_CONFIG.rateLimitPerMinute).toBe(10)
  })
})
