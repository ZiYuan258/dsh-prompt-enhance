/**
 * Shared orchestration for the two host-side enhance entries (the HTTP route
 * and the /enhance slash command): route resolution by precedence, LLM
 * service lookup, one enhanceText call. Keeping both entries on this path
 * prevents their behavior from drifting.
 * @module dsh-prompt-enhance/orchestrate
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { effectiveSystemPrompt, type Config } from './config'
import { DEFAULT_SYSTEM_PROMPT, withContextRules } from './prompts'
import { buildConversationContext } from './context'
import { EnhanceFailure, enhanceText, resolveRoute, toEnhanceError, type RoutePair } from './enhancer'
import type { EnhanceResult } from './shared/protocol'
import { countText } from './shared/validate'

/** Structural face of one logged request header (brand types stay off the wire path). */
interface EpochHeaderLike {
  config?: { provider?: unknown; model?: unknown }
}

/**
 * Structural face of the sessions store.
 *
 * `requestHeader` is a **method** in every dsh release checked so far —
 * `Session.requestHeader(): EpochHeader | undefined` (0.1.1-rc.2 `lib/index.js:1497`,
 * 0.1.2-alpha.3 `lib/index.js:1393`). Reading it as a property yields the
 * function object, whose `.config` is `undefined`, which silently disabled this
 * whole precedence layer. The property shape is still accepted defensively so a
 * flip in either direction degrades to the other branch instead of a TypeError.
 */
interface SessionsFace {
  get(id: string): {
    requestHeader?: (() => EpochHeaderLike | undefined) | EpochHeaderLike
    /** The derived LLM message history; absent on hosts that never expose it. */
    deriveMessages?: () => readonly unknown[]
  } | undefined
}

/**
 * Structural face of the harness default-model service.
 *
 * Current releases own the default selection as a real service
 * (`dsh-agent-default-model` → `agentDefaultModel.currentSelection()`; the class
 * is `AgentDefaultModelConfig extends Service`, registered under
 * `agentDefaultModel`). The earlier releases this plugin targeted exposed it as
 * a settings section instead, reachable through `settings.get(ns)`, which no
 * longer exists — reading it that way threw `ctx.get(...)?.get is not a
 * function` and failed every enhancement that did not carry a session route.
 */
interface AgentDefaultModelFace {
  currentSelection?: () => { provider?: unknown; model?: unknown } | undefined
}

/** Structural face of the settings provider (current releases). */
interface SettingsFace {
  /**
   * Project the active plugin schemas and their live values, keyed by profile
   * entry id. The legacy `get(ns)` reader is absent here; it is probed
   * separately so a release that dropped it degrades instead of throwing.
   */
  describe?: () => readonly { ns?: unknown; value?: unknown }[]
  /** Legacy section reader, still accepted defensively; not a function today. */
  get?: (ns: string) => unknown
}

/** The legacy settings entry id carrying the default model on older releases. */
const DEFAULT_MODEL_LEGACY_NS = 'agent-default-model'

/** Narrow an untrusted provider/model pair into a route (trimmed). */
function routeOf(config: { provider?: unknown; model?: unknown } | null | undefined): RoutePair | undefined {
  if (config === null || config === undefined) return undefined
  const provider = typeof config.provider === 'string' ? config.provider.trim() : ''
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * The session's logged request route (provider/model of its last request
 * header), when a live session with a request header exists.
 */
export function sessionRouteOf(ctx: Context, sessionId: string | undefined): RoutePair | undefined {
  if (sessionId === undefined || sessionId === '') return undefined
  const session = (ctx.get('sessions') as SessionsFace | undefined)?.get(sessionId)
  const header = session?.requestHeader
  let epoch: EpochHeaderLike | undefined
  try {
    epoch = typeof header === 'function' ? header.call(session) : header
  } catch {
    // A session-layer hiccup (frozen object, a future signature change,
    // anything a getter throws) must degrade to the harness default route —
    // never turn one enhance request into a 502 / 「增强失败」.
    return undefined
  }
  return routeOf(epoch?.config)
}

/**
 * The harness-wide default model selection registered by dsh-agent-default-model.
 *
 * Three reader shapes are probed, newest first, and every one of them is
 * optional-chained AND wrapped: this is the fallback layer of route resolution,
 * so a host that renamed or removed the reader must lose the layer, never the
 * request. (The 0.1.7-rc.1 regression was exactly this: `settings.get` is gone,
 * and an unguarded call threw before either remaining layer could answer.)
 * @param ctx - registrant context (optional `agentDefaultModel` / `settings`).
 * @returns the trimmed route, or undefined to let the caller keep looking.
 */
export function defaultRouteOf(ctx: Context): RoutePair | undefined {
  // Current shape: a dedicated service that owns the selection.
  const defaultModel = ctx.get('agentDefaultModel') as AgentDefaultModelFace | undefined
  if (typeof defaultModel?.currentSelection === 'function') {
    try {
      const route = routeOf(defaultModel.currentSelection())
      if (route !== undefined) return route
    } catch {
      // Fall through to the legacy readers.
    }
  }

  const settings = ctx.get('settings') as SettingsFace | undefined
  // Legacy shape: a settings section addressed by entry id.
  if (typeof settings?.get === 'function') {
    try {
      const route = routeOf(settings.get(DEFAULT_MODEL_LEGACY_NS) as { provider?: unknown; model?: unknown } | undefined)
      if (route !== undefined) return route
    } catch {
      // Fall through to the descriptor scan.
    }
  }
  // Intermediate shape: the live values projected through `describe()`, keyed by
  // profile entry id — the owner's entry id ends with the legacy namespace.
  if (typeof settings?.describe === 'function') {
    try {
      const descriptor = settings.describe().find((entry) => (
        typeof entry?.ns === 'string' && entry.ns.endsWith(DEFAULT_MODEL_LEGACY_NS)
      ))
      return routeOf(descriptor?.value as { provider?: unknown; model?: unknown } | undefined)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * The conversation-context snippet for one enhancement, or nothing at all.
 *
 * Every failure mode here degrades to the ORIGINAL single-prompt behaviour:
 * context switched off, no session id (the 0.1.2-rc.1 input slots no longer
 * carry one), unknown session, missing/throws history, or a window too small
 * to admit a single turn. Grounding is an optimization, never a requirement —
 * an enhancement must never fail because history could not be read.
 * @param ctx - registrant context (optional `sessions`).
 * @param sessionId - the session the draft belongs to, when known.
 * @param config - the resolved config (switch + window).
 * @param draft - the raw draft being enhanced.
 * @returns the framed snippet, or undefined to run unconstrained.
 */
export function conversationContextOf(ctx: Context, sessionId: string | undefined, config: Config, draft: string): string | undefined {
  if (!config.contextAware) return undefined
  if (sessionId === undefined || sessionId === '') return undefined
  const session = (ctx.get('sessions') as SessionsFace | undefined)?.get(sessionId)
  if (session === undefined) return undefined
  let messages: readonly unknown[]
  try {
    const derived = session.deriveMessages?.()
    if (derived === undefined || !Array.isArray(derived)) return undefined
    messages = derived
  } catch {
    // A session-layer hiccup must not turn one enhance request into a 502.
    return undefined
  }
  return buildConversationContext(
    messages,
    { maxMessages: config.contextMaxMessages, maxChars: config.contextMaxChars },
    draft,
  )
}

/** One orchestration request. */
export interface RunEnhanceOptions {
  /** The raw draft to rewrite (already validated by the caller). */
  text: string
  /** The session's logged request route, when known. */
  sessionRoute?: RoutePair
  /** Caller cancellation (HTTP disconnect / command dispatch). */
  signal?: AbortSignal
  /** Session identity stamped onto the request for adapter routing. */
  sessionId?: string
  /** Pre-built context snippet; when absent it is derived from the session. */
  context?: string
  /** Receives each text delta for incremental display (display only). */
  onDelta?: (delta: string) => void
}

/**
 * Resolve the model route (settings pair → session route → harness default),
 * look up the LLM service, and run one normalized enhancement.
 * @throws an error whose `detail` (via `toEnhanceError`) carries the wire
 *   error — `unconfigured` when no route resolves, `internal` when the LLM
 *   service is absent, or whatever `enhanceText` raised.
 */
export async function runEnhance(ctx: Context, config: Config, options: RunEnhanceOptions): Promise<EnhanceResult> {
  // Structured, single-line observability: request id and sizes only — never
  // the prompt text, the model output, or the provider/model names (those can
  // carry internal gateway or project identifiers). Sizes use the same
  // code-point gauge the input check reports to the user, so the two never
  // disagree.
  const requestId = randomUUID().slice(0, 8)
  const started = Date.now()
  try {
    const route = resolveRoute(config, options.sessionRoute, defaultRouteOf(ctx))
    if (route === undefined) {
      // No detail line: the fix instructions are the localized primary copy.
      throw new EnhanceFailure({ code: 'unconfigured' })
    }
    const llm = ctx.get('llm')
    if (llm === undefined) {
      throw new EnhanceFailure({ code: 'internal' })
    }
    const context = options.context !== undefined
      ? options.context
      : conversationContextOf(ctx, options.sessionId, config, options.text)
    const result = await enhanceText(llm, {
      route,
      // The context rules ride along ONLY when there is context to reason
      // about, so a context-free call keeps byte-identical instructions.
      system: effectiveSystemPrompt(config, context === undefined ? DEFAULT_SYSTEM_PROMPT : withContextRules(DEFAULT_SYSTEM_PROMPT)),
      text: options.text,
      temperature: config.temperature,
      reasoningEffort: config.reasoningEffort,
      maxTokens: config.maxOutputTokens,
      timeoutMs: config.timeoutMs,
      signal: options.signal,
      ...(context !== undefined ? { context } : {}),
      ...(options.onDelta !== undefined ? { onDelta: options.onDelta } : {}),
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    })
    console.info(`[prompt-enhance] ${requestId} in=${countText(options.text)} out=${countText(result.text)} ctx=${context === undefined ? 0 : 1} ${result.elapsedMs}ms ok`)
    return result
  } catch (error) {
    const wire = toEnhanceError(error)
    console.info(`[prompt-enhance] ${requestId} in=${countText(options.text)} error=${wire.code} ${Date.now() - started}ms`)
    throw error
  }
}
