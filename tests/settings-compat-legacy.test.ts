/**
 * The legacy-helper failure, isolated into its own file.
 *
 * Its own file because `vi.mock`'s factory is evaluated ONCE per file, which is
 * measured rather than assumed: in a shared file, flipping a control flag and
 * calling `vi.resetModules()` still handed the plugin's import an empty module, so
 * one file cannot present two different module shapes. Here the legacy shape is
 * the only shape.
 *
 * The scenario is the real one. A stale build in this project resolved an old
 * `@deepseek-ai/dsh-settings` from its own `node_modules` and reached the host's
 * settings service through `installSettingsSection`, which died with
 *
 *     [E] [prompt-enhance] TypeError: sctx.settings.register is not a function
 *
 * A modern host exposes no `register()` at all — it derives the form from the
 * plugin's `Config` schema — so that helper cannot succeed here. What must hold is
 * narrower and more important than the helper succeeding: **the failure has to be
 * contained.** The call sits in a promise continuation, so an escaping throw is an
 * unhandled rejection, and an unhandled rejection is worse than a missing settings
 * section: it can surface as an activation failure somewhere else entirely.
 *
 * The stub THROWS where the real modules merely lacked a method, deliberately. A
 * stub that dutifully returned `undefined` would only prove the happy path; the
 * contract is about a helper that fails.
 * @module tests/settings-compat-legacy
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

/**
 * The call ledger, and the reason it is hoisted.
 *
 * `vi.resetModules()` makes Vitest RE-EVALUATE this file's mock factory — measured,
 * not assumed: with a plain module-level array the factory produced a fresh array
 * on re-evaluation, so the test watched an empty ledger while the mock pushed into
 * a different one. `vi.hoisted` creates the object once, above the factory, so the
 * factory closes over the same reference every time it runs.
 */
const ledger = vi.hoisted(() => ({ calls: [] as unknown[][] }))

vi.mock('@deepseek-ai/dsh-settings', () => ({
  settingsNamespace: (ns: string): string => ns,
  installSettingsSection: (...args: unknown[]): void => {
    ledger.calls.push(args)
    throw new TypeError('sctx.settings.register is not a function')
  },
}))

/**
 * The settings service a host actually exposes when the legacy path runs.
 *
 * It must NOT provide `installSection`. The compatibility layer prefers that
 * method and returns early when it exists — measured: with it present the service
 * was read for `installSection` and the legacy helper was never reached (`calls: 0`,
 * which is correct behaviour but exercises the wrong branch). The real failing host
 * had no `installSection` either, which is exactly why the stale helper was reached
 * and then tripped over the missing `register()`.
 *
 * So every other method reads as undefined, and CALLING one throws — the shape the
 * legacy helper dies on.
 * @returns the service stub plus the names it was asked for.
 */
function settingsService(): { service: Record<string, unknown>; reads: string[] } {
  const reads: string[] = []
  const service: Record<string, unknown> = new Proxy({}, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') return undefined
      reads.push(prop)
      return undefined
    },
  })
  return { service, reads }
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

beforeEach(() => {
  unhandled.length = 0
  ledger.calls.length = 0
  process.on('unhandledRejection', onUnhandled)
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
})

describe('a legacy helper that throws, on a host with no register()', () => {
  it('contains the throw instead of letting it become an unhandled rejection', async () => {
    // Deliberately NO `vi.resetModules()` here. Measured: after a reset, this
    // file's mocked dynamic import did not resolve for the plugin at all, so the
    // legacy helper was never reached and the test asserted against a path it had
    // not exercised — a green-looking test of nothing. This file presents a single
    // module shape, so there is nothing to reset between its tests.
    const mod = await import('../src/index')

    const probed: string[] = []
    const injected: string[][] = []
    const { service, reads } = settingsService()
    const ctx: Record<string, unknown> = {
      get: (name: string): unknown => { probed.push(name); return undefined },
      inject: (deps: string[], cb: (child: unknown) => void): void => {
        injected.push(deps)
        if (deps.includes('settings')) cb({ ...ctx, settings: service })
      },
      effect: (fn: () => (() => void) | void): (() => void) => {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
    }

    // Applying must not throw, whatever the settings service turns out to be.
    expect(() => mod.apply(ctx as unknown as Context)).not.toThrow()

    // The legacy call happens in a promise continuation, and the dynamic import
    // resolves well behind the microtask queue (measured: not after 3 ticks, but
    // yes after 23), so wait for the observable effect rather than a tick count.
    for (let i = 0; i < 200 && ledger.calls.length === 0; i += 1) await Promise.resolve()

    // Give an escaping rejection its own turn to be reported.
    //
    // This wait is the difference between a test that guards the fix and one that
    // only looks like it does. MEASURED against the pre-fix build: right after the
    // call the rejection had not been reported yet (`seen: []`), and only after a
    // macrotask did it appear (`seen: ["sctx.settings.register is not a function"]`).
    // Asserting before that window passes is green either way.
    await new Promise((resolve) => { setTimeout(resolve, 100) })

    // The compatibility layer really did reach the legacy helper...
    expect(ledger.calls).toHaveLength(1)
    // ...because the service offered no `installSection`, which is the only reason
    // that branch is reachable at all...
    expect(reads).toContain('installSection')
    expect(reads).not.toContain('register')
    // ...and the throw it raised did not escape.
    expect(unhandled).toEqual([])
  })

  it('finishes activation regardless: the route and command wiring still runs', async () => {
    vi.resetModules()
    const mod = await import('../src/index')

    const probed: string[] = []
    const { service } = settingsService()
    const ctx: Record<string, unknown> = {
      get: (name: string): unknown => { probed.push(name); return undefined },
      inject: (deps: string[], cb: (child: unknown) => void): void => {
        if (deps.includes('settings')) cb({ ...ctx, settings: service })
      },
      effect: (fn: () => (() => void) | void): (() => void) => {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
    }

    mod.apply(ctx as unknown as Context)
    for (let i = 0; i < 200 && ledger.calls.length === 0; i += 1) await Promise.resolve()

    // A failing optional integration must not gate the required wiring: both
    // optional services were still probed after it.
    expect(probed).toContain('webServer')
    expect(probed).toContain('commands')
  })
})
