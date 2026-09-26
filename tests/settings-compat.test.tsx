// @vitest-environment jsdom
/**
 * Settings-integration compatibility: whatever the host's settings service looks
 * like, registering the section must never be able to kill the plugin.
 *
 * This exists because of a real failure. A host logged
 *
 *     [E] [prompt-enhance] TypeError: sctx.settings.register is not a function
 *         at Module.installSettingsSection (…/dsh-settings/lib/index.js:619)
 *         at file:///D:/Vibe coding/_pe_probe/lib/index.js:967
 *
 * The plugin bundles no such call, and never has (`git log --all -S
 * "settings.register"` is empty). That trace came from a stale checkout whose
 * OLD `node_modules` resolved an OLD `@deepseek-ai/dsh-settings`, which reached
 * the host's service through the legacy `installSettingsSection` path. A modern
 * host derives its settings form from the plugin's `Config` schema and exposes no
 * `register()` at all — `dsh-market` logged the identical complaint on the same
 * boot.
 *
 * The contract these tests lock is deliberately narrow: **no settings-API shape
 * may prevent the plugin from finishing activation.** They do not assert that any
 * legacy API exists, that a section was registered, or that a host generation was
 * detected.
 *
 * Two harness hazards, both measured rather than assumed, and both the reason this
 * file is shaped the way it is:
 *
 * 1. The legacy call happens inside `void import().then(…)`, and that dynamic
 *    import resolves far behind the microtask queue — after 3 ticks it had not run,
 *    after 23 it had. Asserting on a fixed tick count asserts too early AND lets a
 *    rejection surface after the test has ended. So assertions wait for the
 *    observable effect (`settleUntil`).
 * 2. The plugin's background import can still be in flight when a test ends. A
 *    test-local `vi.doMock` leaves that dangling import to settle against a
 *    cancelled mock and reject inside the NEXT test, which surfaced as
 *    `[vitest] No "installSettingsSection" export is defined on the mock` — a
 *    Vitest complaint that reads like a plugin failure. So ONE module-level mock
 *    stays installed for the whole file and reads a mutable control object at call
 *    time; no test ever installs or cancels a mock of its own.
 * @module tests/settings-compat
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

/**
 * The stubbed module for THIS file: no legacy exports at all.
 *
 * That is the whole shape under test here — a modern host plus a module that
 * offers no helpers — so it is declared statically rather than mutated per test.
 * The throwing-helper case needs a different module shape and lives in
 * `settings-compat-legacy.test.tsx`, because `vi.mock`'s factory is evaluated once
 * per file and cannot present two shapes.
 */
vi.mock('@deepseek-ai/dsh-settings', () => ({}))

/** Names of every method the plugin reads off a settings service. */
interface SettingsProbe {
  calls: string[]
}

/**
 * A settings service stub that records which methods the plugin reaches for.
 *
 * Deliberately minimal: reading any method other than `installSection` yields
 * undefined, so CALLING one throws the same TypeError a modern host produced —
 * which is the failure under test — rather than being silently ignored.
 * @param speaksInstallSection - whether the service implements the alpha/rc.2 API.
 * @returns the service stub plus its read ledger.
 */
function settingsService(speaksInstallSection: boolean): { service: Record<string, unknown>; probe: SettingsProbe } {
  const probe: SettingsProbe = { calls: [] }
  const service: Record<string, unknown> = new Proxy({}, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') return undefined
      probe.calls.push(prop)
      if (prop === 'installSection' && speaksInstallSection) return (): void => {}
      return undefined
    },
  })
  return { service, probe }
}

interface Harness {
  apply: (ctx: unknown, config?: unknown) => void
  /** Service names probed through ctx.get. */
  probed: string[]
  /** Dependency arrays passed to ctx.inject. */
  injected: string[][]
}

/**
 * Build a registrant context for the plugin.
 *
 * `webServer` and `commands` are exposed only when asked for, so `apply` runs the
 * same wiring a real composition would.
 * @param harness - ledgers to record into.
 * @param services - optional services this context provides.
 * @returns the stub context.
 */
function stubContext(harness: Harness, services: {
  settings?: unknown
  webServer?: boolean
  commands?: boolean
}): Context {
  const present = (name: string): boolean => {
    if (name === 'settings') return services.settings !== undefined
    if (name === 'webServer') return services.webServer === true
    if (name === 'commands') return services.commands === true
    return false
  }
  const ctx: Record<string, unknown> = {
    get: (name: string): unknown => {
      harness.probed.push(name)
      return undefined
    },
    inject: (deps: string[], cb: (child: unknown) => void): void => {
      harness.injected.push(deps)
      if (!deps.every(present)) return
      cb({ ...ctx, ...(services.settings !== undefined ? { settings: services.settings } : {}) })
    },
    effect: (fn: () => (() => void) | void): (() => void) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  return ctx as unknown as Context
}

/** Ledgers the plugin writes into, rebuilt per test. */
let harness: Harness

/**
 * Import a fresh copy of the plugin and prepare its ledgers.
 * @returns the loaded harness.
 */
async function loadPlugin(): Promise<Harness> {
  vi.resetModules()
  const mod = await import('../src/index')
  return {
    apply: mod.apply as (ctx: unknown, config?: unknown) => void,
    probed: [],
    injected: [],
  }
}

/**
 * Spin the microtask queue until `predicate` holds.
 * @param predicate - resolves true once the awaited effect has happened.
 */
async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i += 1) await Promise.resolve()
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

beforeEach(() => {
  unhandled.length = 0
  process.on('unhandledRejection', onUnhandled)
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
})

describe('a host whose settings service has no legacy register()', () => {
  it('throws nothing while applying, and never calls an absent settings method', async () => {
    harness = await loadPlugin()
    const { service, probe } = settingsService(false)
    const ctx = stubContext(harness, { settings: service })

    expect(() => harness.apply(ctx)).not.toThrow()
    await settleUntil(() => probe.calls.length > 0)

    expect(unhandled).toEqual([])
    // The modern service was consulted, and the compatibility layer had nothing
    // legacy to call — as opposed to calling something that is not there.
    expect(probe.calls).toContain('installSection')
    expect(probe.calls).not.toContain('register')
  })

  it('still finishes activation: the settings probe never gates the rest of apply', async () => {
    harness = await loadPlugin()
    const { service, probe } = settingsService(false)
    const ctx = stubContext(harness, { settings: service })

    harness.apply(ctx)
    await settleUntil(() => probe.calls.length > 0)

    expect(harness.injected.some((deps) => deps.includes('settings'))).toBe(true)
    expect(harness.probed).toContain('webServer')
    expect(harness.probed).toContain('commands')
  })
})

describe('the modern path, when the service speaks installSection', () => {
  it('uses installSection and never touches a legacy helper', async () => {
    harness = await loadPlugin()
    const { service, probe } = settingsService(true)
    const ctx = stubContext(harness, { settings: service })

    harness.apply(ctx)
    await settleUntil(() => probe.calls.length > 0)

    expect(probe.calls).toContain('installSection')
    expect(unhandled).toEqual([])
  })
})

/**
 * A stubbed module presenting the legacy helpers cannot live in this file.
 *
 * `vi.mock`'s factory is evaluated once per test file — measured, not assumed:
 * flipping a shared control flag and calling `vi.resetModules()` still handed the
 * import an empty module, so one file cannot show the plugin two different module
 * shapes. The throwing-helper case therefore lives in
 * `settings-compat-legacy.test.tsx`, where that shape is the only one.
 */

