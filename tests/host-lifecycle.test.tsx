/**
 * Lifecycle regression for the host half's service contract.
 *
 * Only `llm` is a hard dependency. `webServer` and `commands` are probed at the
 * point of use, so a composition missing either must still ACTIVATE and keep
 * whatever capability does not need them:
 *
 *                  webServer
 *                 ┌────┴────┐
 *                 │         │
 *                yes        no
 *                 │         │
 *         route + /enhance   /enhance
 *                 │         │
 *                 └── llm ──┘
 *
 * The regression this guards is a declaration drift, not a crash: `webServer`
 * was previously listed in `inject`, which kept the whole plugin — including the
 * `/enhance` command plane and the settings schema, neither of which serves HTTP
 * — in `pending (waiting for service: webServer)` on a non-web composition. The
 * bodies below already treated the service as optional, so nothing threw; the
 * plugin simply never ran.
 *
 * Three runtime facts these tests pin down, each of which produced a test that
 * passed — or failed — for the wrong reason before being handled explicitly:
 *
 * 1. Wiring and requests probe DIFFERENT services (`webServer`/`commands` while
 *    wiring; `sessions`/`agentDefaultModel`/`llm` per enhancement), so the ledger
 *    is recorded per phase. "It never probed X" is meaningless without saying when.
 * 2. `llm` is read per REQUEST inside `runEnhance`.
 * 3. A model stub must emit a COMPLETE text block (`block-start`, deltas,
 *    `block-end`, `finish`). The enhancer reads its text from assembled blocks,
 *    so deltas alone — or a bare `finish` — are correctly rejected as an empty
 *    response, which looks like a plugin failure and is not one.
 * @module tests/host-lifecycle
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply, inject } from '../src/index'

const REWRITE = '结构化的改写结果'

/** A model call that produces one complete text block. */
function stubLlm(onCall: () => void): { stream(options: GenerateOptions): AsyncIterable<StreamChunk> } {
  return {
    stream(): AsyncIterable<StreamChunk> {
      onCall()
      return (async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: REWRITE }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: REWRITE } }
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** One prepared composition plus everything observable about it. */
interface Wiring {
  routes: { path: string }[]
  commands: CommandDefinition[]
  /**
   * Services this context PROVIDES that the plugin asked for, while wiring.
   *
   * Deliberately records only resolved services. Probing an ABSENT optional
   * service is the correct behaviour for an optional dependency, so "the plugin
   * called `get('webServer')`" proves nothing either way; what matters is
   * whether it then wired the HTTP route.
   */
  usedWhileWiring: string[]
  /** Provided services the plugin asked for while an enhancement ran. */
  usedWhileRunning: string[]
  /** Whether the model stream was actually iterated. */
  modelCalled(): boolean
  /** Run the registered /enhance command against a stub agent. */
  runCommand(rawInput: string): Promise<unknown>
}

/**
 * Apply the plugin against a context exposing exactly the named services.
 *
 * `inject` callbacks fire only for deps the context claims, which is how Cordis
 * behaves when a service never mounts — so an absent `webServer` here means the
 * HTTP registration path is never entered, exactly as in a headless composition.
 * @param services - service names this context provides.
 * @returns the captured wiring.
 */
function applyWith(services: readonly string[]): Wiring {
  const routes: { path: string }[] = []
  const commands: CommandDefinition[] = []
  const usedWhileWiring: string[] = []
  const usedWhileRunning: string[] = []
  let phase: string[] = usedWhileWiring
  let modelCalls = 0
  const has = (name: string): boolean => services.includes(name)

  const get = (name: string): unknown => {
    // Only a RESOLVED service is recorded: an absent one is expected to be asked
    // for once and answered with undefined.
    if (!has(name)) return undefined
    phase.push(name)
    if (name === 'llm') return stubLlm(() => { modelCalls += 1 })
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
    if (name === 'webServer') {
      return { register: (options: { path: string }): (() => void) => { routes.push(options); return () => {} } }
    }
    if (name === 'commands') {
      return { register: (definition: CommandDefinition): (() => void) => { commands.push(definition); return () => {} } }
    }
    return undefined
  }

  const ctx = {
    get,
    inject: (deps: string[], cb: (child: unknown) => void): void => {
      if (deps.every(has)) cb({ ...ctx, settings: {} })
    },
    effect: (fn: () => (() => void) | void): (() => void) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }

  apply(ctx as unknown as Context, undefined)
  phase = usedWhileRunning

  return {
    routes,
    commands,
    usedWhileWiring,
    usedWhileRunning,
    modelCalled: () => modelCalls > 0,
    runCommand: async (rawInput: string): Promise<unknown> => {
      const definition = commands[0]
      if (definition === undefined) throw new Error('no /enhance command was registered')
      return definition.handler({
        commandId: 'c1',
        agent: { id: 's1' },
        rawInput,
        attachments: [],
        signal: new AbortController().signal,
      } as never)
    },
  }
}

describe('service contract declaration', () => {
  it('declares llm as the only required service', () => {
    expect(inject).toEqual(['llm'])
  })

  // Named separately so a future edit that re-hardens the web surface fails with
  // a message about THAT service rather than a generic array comparison.
  it('does not list webServer or commands in inject', () => {
    expect(inject).not.toContain('webServer')
    expect(inject).not.toContain('commands')
  })
})

describe('wiring across service availability', () => {
  it('wires both the HTTP route and /enhance when webServer and commands are present', () => {
    const { routes, commands } = applyWith(['llm', 'webServer', 'commands', 'agentDefaultModel'])
    expect(routes).toHaveLength(1)
    expect(routes[0]?.path).toBe('/prompt-enhance')
    expect(commands).toHaveLength(1)
    expect(commands[0]?.name).toBe('enhance')
  })

  it('registers the route, and registers no command, with no command plane', () => {
    const { routes, commands, usedWhileWiring } = applyWith(['llm', 'webServer'])
    expect(routes).toHaveLength(1)
    expect(commands).toHaveLength(0)
    expect(usedWhileWiring).not.toContain('commands')
  })

  it('activates with llm alone: no route, no command, no throw', () => {
    let wiring: Wiring | undefined
    expect(() => { wiring = applyWith(['llm']) }).not.toThrow()
    expect(wiring?.routes).toHaveLength(0)
    expect(wiring?.commands).toHaveLength(0)
    expect(wiring?.usedWhileWiring).not.toContain('webServer')
    expect(wiring?.usedWhileWiring).not.toContain('commands')
  })
})

describe('the /enhance command without a web surface', () => {
  // The regression: no web server must cost the ROUTE only.
  it('registers /enhance and runs it successfully with no webServer', async () => {
    const wiring = applyWith(['llm', 'commands', 'agentDefaultModel'])
    expect(wiring.routes).toHaveLength(0)
    expect(wiring.commands).toHaveLength(1)

    const result = await wiring.runCommand('帮我写个爬虫')
    expect(result).toEqual({ kind: 'success', text: REWRITE })
    expect(wiring.modelCalled()).toBe(true)
  })

  it('resolves its route and calls the model without ever using webServer', async () => {
    const wiring = applyWith(['llm', 'commands', 'agentDefaultModel'])
    await wiring.runCommand('帮我写个爬虫')
    expect(wiring.usedWhileRunning).toContain('llm')
    expect(wiring.usedWhileRunning).not.toContain('webServer')
  })

  // A missing model service must surface as a readable error, never a throw:
  // the command plane owns the message the user reads.
  it('reports a readable error instead of throwing when no model is available', async () => {
    const wiring = applyWith(['commands', 'agentDefaultModel'])
    const result = await wiring.runCommand('帮我写个爬虫') as { kind: string; text?: string }
    expect(result.kind).toBe('error')
    expect(typeof result.text).toBe('string')
    expect(wiring.modelCalled()).toBe(false)
  })
})
