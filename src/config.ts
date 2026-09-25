/**
 * Plugin configuration: one schemastery schema rendered automatically by
 * Settings → 插件配置, plus pure resolution/validation shared by the host
 * route, the slash command, and (mirrored defaults) the browser half.
 *
 * Two properties of that schema carry the whole Settings surface, and both are
 * easy to lose silently:
 * - The schema must be a NAMED EXPORT of this package. The loader mounts
 *   `unwrapExports(module)` and Cordis records `plugin.Config` as the entry's
 *   runtime schema; `dsh-settings` builds the form from
 *   `entry.fiber.runtime.Config` and from nothing else. There is no
 *   registration call — the older `installSettingsSection` paths are dead on
 *   current hosts and fail without a word.
 * - Every field must be `.volatile()`. `dsh-settings`' `volatileForm()` returns
 *   undefined for a schema with no volatile field, and `describe()` then skips
 *   the entry entirely, so a non-volatile schema renders as an EMPTY Settings
 *   page. The cost is that the loader hands `resolveConfig` volatile
 *   references instead of values, which it unwraps.
 * @module dsh-prompt-enhance/config
 */

/**
 * The harness's own schemastery build, not the public `schemastery` package.
 *
 * `dsh` ships a fork (`@deepseek-ai/schemastery`, published) and every built-in
 * plugin imports it — `dsh-agent-default-model` in its own source. The two
 * builds are NOT interchangeable at runtime: `.volatile()` exists only in the
 * fork (`public 3.18.0` exposes `default/description/hidden/…` and no
 * `volatile`), while the fork's `SchemaOutput` admits the private
 * `Volatile<T>` reference. Depending on the fork therefore does double duty:
 * it is what makes `.volatile()` callable (the Settings form depends on it),
 * and it removes the type skew that previously needed a cast on the export.
 */
import z from '@deepseek-ai/schemastery'

/** Settings namespace of the plugin section. */
export const PROMPT_ENHANCE_NAMESPACE = 'prompt-enhance'

/** How a non-empty `systemPrompt` combines with the built-in strategy. */
export type StrategyMode = 'replace-default' | 'extend-default'

/**
 * Reasoning budget forwarded to the rewrite call. The three shipped effort ids
 * plus `inherit`: the model advertises which it accepts (`off|low|high|max` on
 * deepseek-flash), and `inherit` leaves the field unset so the route default
 * applies — the field is omitted rather than guessed.
 */
export type ReasoningEffortChoice = 'off' | 'low' | 'high' | 'inherit'

/** The plugin's deployed configuration. */
export interface Config {
  /** Master switch; off hides the composer button and disables all triggers. */
  enabled: boolean
  /** Explicit provider override; must be paired with `model`. */
  provider?: string
  /** Explicit model override; must be paired with `provider`. */
  model?: string
  /** Sampling temperature; low keeps the rewrite faithful to the original. */
  temperature: number
  /**
   * Reasoning budget for the rewrite, forwarded to the model call.
   *
   * A rewrite is a short, well-specified text transformation; it does not need
   * deep reasoning, and the route's own default can be expensive. Measured on
   * deepseek-flash with one ordinary draft: `off` spent 252 output tokens and
   * returned 439 characters of text, `low` spent 619, and the route default
   * (`high`) spent 2897 for 979 characters. `off` is therefore the default here,
   * which is also why the plugin must send it EXPLICITLY — omitting the field
   * silently inherits the expensive route default.
   *
   * `inherit` omits the field entirely, for routes that reject an explicit
   * effort.
   */
  reasoningEffort: ReasoningEffortChoice
  /** Output token budget of one enhancement call. */
  maxOutputTokens: number
  /** Input character cap; over-length drafts are rejected, never truncated. */
  maxInputChars: number
  /** End-to-end deadline of one enhancement call. */
  timeoutMs: number
  /** System prompt; default is the built-in enhancement strategy. */
  systemPrompt: string
  /**
   * How a non-empty `systemPrompt` combines with the built-in strategy.
   * `replace-default` (the default, matching earlier versions) swaps the
   * built-in strategy out entirely — its hard rules are NOT retained and must
   * be carried into the custom text. `extend-default` appends the custom text
   * after the built-in strategy, keeping those rules in force.
   */
  strategyMode: StrategyMode
  /** Composer keyboard shortcut, e.g. "ctrl+alt+e"; empty disables it. */
  shortcut: string
  /** Max concurrently running enhancements (host-side resource cap). */
  maxConcurrent: number
  /** Sliding-window rate cap: enhancements per minute (host-side). */
  rateLimitPerMinute: number
  /**
   * Show the model's output in the panel as it streams instead of waiting for
   * the whole rewrite. Display-only: the final text is still the normalized
   * full result, so the output the user applies never changes.
   */
  streaming: boolean
  /**
   * Read the current conversation's recent history and use it to ground the
   * rewrite (resolve references, supply the established stack/constraints).
   * With no session, no history, or this switch off, the call degrades to the
   * original single-prompt enhancement.
   */
  contextAware: boolean
  /** Context window breadth: how many recent turns may ground the rewrite; 0 admits none. */
  contextMaxMessages: number
  /** Context window depth: character budget of the assembled history snippet; 0 admits none. */
  contextMaxChars: number
}

/** Field defaults, the source of truth for schema defaults and client mirrors. */
export const DEFAULT_CONFIG: Config = {
  enabled: true,
  temperature: 0.3,
  // A rewrite does not need deep reasoning, and the route default is expensive
  // (measured: 2897 output tokens at `high` vs 252 at `off` for the same draft).
  // Sent explicitly, because omitting the field inherits that route default.
  reasoningEffort: 'off',
  // Output budget. Reasoning models spend this budget BEFORE any visible text, so
  // a low cap can be consumed by reasoning alone and finish with zero text — the
  // original 2048 did exactly that on ordinary drafts. The route's own
  // defaultMaxTokens can be far larger (deepseek-flash advertises 256000), so this
  // stays a conservative cap that no longer strangles the rewrite.
  maxOutputTokens: 8192,
  maxInputChars: 12000,
  timeoutMs: 60000,
  systemPrompt: '',
  strategyMode: 'replace-default',
  shortcut: 'ctrl+alt+e',
  maxConcurrent: 2,
  rateLimitPerMinute: 10,
  streaming: true,
  contextAware: true,
  contextMaxMessages: 8,
  contextMaxChars: 4000,
}

/**
 * The settings section schema (rendered by the built-in plugin config page).
 *
 * The cast is deliberate and load-bearing. With `.volatile()` on every field the
 * schema's OUTPUT type is `Volatile<T>` (the harness's live-reference wrapper),
 * while `Config` describes the plain shape the rest of the package consumes —
 * `resolveConfig` is the single boundary that flattens one into the other. The
 * assertion states that contract; it is not a workaround for a type error, and
 * removing `.volatile()` to make it unnecessary would take the Settings page
 * with it.
 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().volatile().default(DEFAULT_CONFIG.enabled).description('总开关：关闭后隐藏输入框增强按钮并停用所有触发方式'),
  provider: z.string().volatile().description('覆盖模型路由的 provider（与「模型」必须成对填写；留空跟随当前会话模型）'),
  model: z.string().volatile().description('覆盖模型路由的 model（与「provider」必须成对填写；留空跟随当前会话模型）'),
  temperature: z.number().volatile().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.temperature).description('采样温度；低温改写更忠实于原意'),
  reasoningEffort: z.union(['off', 'low', 'high', 'inherit']).volatile().default(DEFAULT_CONFIG.reasoningEffort).description('推理预算：改写是短而明确的任务，不需要深度思考，而模型自身的默认档往往很贵（同一句话：off 约 252 输出 token，high 约 2897）。off/low 最省；inherit 表示不传该字段、完全跟随模型的默认档'),
  maxOutputTokens: z.number().volatile().step(1).min(256).max(65536).default(DEFAULT_CONFIG.maxOutputTokens).description('单次增强的输出 token 上限；推理模型会先消耗预算做思考，上限太低会出现「只有思考、没有正文」'),
  maxInputChars: z.number().volatile().step(1).min(200).max(200000).default(DEFAULT_CONFIG.maxInputChars).description('输入字数上限；超限拒绝而不截断，避免改变原意'),
  timeoutMs: z.number().volatile().step(1).min(5000).max(600000).default(DEFAULT_CONFIG.timeoutMs).description('单次增强的超时（毫秒）'),
  systemPrompt: z.string().volatile().role('textarea').default(DEFAULT_CONFIG.systemPrompt).description('系统提示词；留空使用内置增强策略'),
  strategyMode: z.union(['replace-default', 'extend-default']).volatile().default(DEFAULT_CONFIG.strategyMode).description('自定义系统提示词的组合方式：整体替换内置策略（默认；内置策略的不编造、只输出正文等硬性约束不会自动保留），或把自定义文本追加在内置策略之后（硬性约束继续生效）'),
  shortcut: z.string().volatile().default(DEFAULT_CONFIG.shortcut).description('触发快捷键（如 ctrl+alt+e；须包含 ctrl/alt/meta 中至少一个修饰键，shift 仅可作附加，纯字母/数字或 shift+字母会被忽略；留空禁用）'),
  maxConcurrent: z.number().volatile().step(1).min(1).max(16).default(DEFAULT_CONFIG.maxConcurrent).description('宿主侧并发上限：同时进行的增强调用数，超出的请求返回 429'),
  rateLimitPerMinute: z.number().volatile().step(1).min(1).max(600).default(DEFAULT_CONFIG.rateLimitPerMinute).description('每分钟增强次数上限（滑动窗口），超出返回 429'),
  streaming: z.boolean().volatile().default(DEFAULT_CONFIG.streaming).description('增量展示：模型边写边在面板显示（仅影响显示节奏，最终结果不变；宿主或网络不支持时自动回退为一次性返回）'),
  contextAware: z.boolean().volatile().default(DEFAULT_CONFIG.contextAware).description('上下文感知：读取当前会话近期对话，用于消解指代、补全省略与术语约束；无历史或历史不足时自动回退为单条增强，不臆造信息'),
  contextMaxMessages: z.number().volatile().step(1).min(0).max(50).default(DEFAULT_CONFIG.contextMaxMessages).description('上下文窗口（条数）：最多参考最近多少条 user/assistant 轮次；0 表示不参考'),
  contextMaxChars: z.number().volatile().step(1).min(0).max(100000).default(DEFAULT_CONFIG.contextMaxChars).description('上下文窗口（字数）：历史片段的字符预算，从最新一条向前装配；0 表示不参考'),
}) as unknown as z<Config>

/** Validated reasoning choices; `inherit` means "send no effort field at all". */
const REASONING_CHOICES: readonly ReasoningEffortChoice[] = ['off', 'low', 'high', 'inherit']

/**
 * Normalize a stored reasoning choice. Anything unrecognized — a section stored
 * before the field existed, or a hand-edited value — falls back to the shipped
 * default, which is the cheapest one; an unknown string must never reach the
 * adapter as an effort id it will reject.
 * @param value - untrusted stored value.
 * @returns the validated choice.
 */
function resolveReasoningEffort(value: unknown): ReasoningEffortChoice {
  return REASONING_CHOICES.find((choice) => choice === value) ?? DEFAULT_CONFIG.reasoningEffort
}

/**
 * Read one field out of a resolved config without caring how it arrived.
 *
 * Every schema field is `.volatile()`, which is what makes the Settings →
 * 插件配置 form exist at all: `dsh-settings` projects a form only from a schema
 * with volatile fields (`volatileForm` returns undefined otherwise, and
 * `describe()` then skips the entry entirely). The price is that the loader
 * hands the plugin a `Volatile<T>` REFERENCE — an object with `get()` — rather
 * than the value, so `config.temperature` would be an object and every numeric
 * comparison below would misbehave.
 *
 * Plain values (a directly constructed config in tests, or a harness that
 * resolves without the volatile wrapper) are returned unchanged.
 * @param value - one field of the resolved config, wrapped or plain.
 * @returns the plain value, or undefined when the reference reports none.
 */
function unwrap<T>(value: T): unknown {
  const reference = value as { get?: unknown } | null | undefined
  if (reference !== null && typeof reference === 'object' && typeof reference.get === 'function') {
    return (reference.get as () => unknown)()
  }
  return value
}

/**
 * Validate and detach one resolved config. Unknown keys (leftovers from older
 * versions) are stripped — only the schema-known fields survive. The loader
 * fills schema defaults before apply; this re-checks the invariants the
 * schema cannot express (provider/model pairing, non-empty route strings) so
 * a bad stored section fails loud at the boundary instead of inside a model
 * call.
 * @param source - untrusted resolved section (volatile references unwrapped).
 * @returns the validated config, unknown keys removed.
 * @throws Error describing the first violated invariant.
 */
export function resolveConfig(source: Config): Config {
  if (source === null || typeof source !== 'object') throw new Error('prompt-enhance: configuration is required')
  // Flatten first, then validate: every read below must see values, not
  // references, including the `enabled` boolean check (a reference is always
  // truthy, so it would silently pass a `false` section).
  const config = Object.fromEntries(
    Object.entries(source as unknown as Record<string, unknown>).map(([key, value]) => [key, unwrap(value)]),
  ) as unknown as Config
  if (typeof config.enabled !== 'boolean') throw new Error('prompt-enhance: enabled 必须是布尔值')
  const hasProvider = config.provider !== undefined && config.provider !== ''
  const hasModel = config.model !== undefined && config.model !== ''
  if (hasProvider !== hasModel) {
    throw new Error('prompt-enhance: provider 与 model 必须成对填写（要么都填，要么都留空以跟随当前会话模型）')
  }
  const provider = hasProvider ? (config.provider ?? '').trim() : config.provider
  const model = hasModel ? (config.model ?? '').trim() : config.model
  if ((hasProvider && provider === '') || (hasModel && model === '')) {
    throw new Error('prompt-enhance: provider/model 覆盖必须是非空字符串')
  }
  const temperature = config.temperature
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error('prompt-enhance: temperature 必须是 0–1 之间的有限数字')
  }
  const intInRange = (value: unknown, name: string, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`prompt-enhance: ${name} 必须是 ${min}–${max} 之间的整数`)
    }
    return value
  }
  return {
    enabled: config.enabled,
    provider,
    model,
    temperature,
    // Absent (a section stored before this field existed) means the cheapest
    // shipped default; an unrecognized hand-edited value degrades the same way
    // rather than reaching the model call as a rejected effort id.
    reasoningEffort: resolveReasoningEffort(config.reasoningEffort),
    maxOutputTokens: intInRange(config.maxOutputTokens, 'maxOutputTokens', 256, 65536),
    maxInputChars: intInRange(config.maxInputChars, 'maxInputChars', 200, 200000),
    timeoutMs: intInRange(config.timeoutMs, 'timeoutMs', 5000, 600000),
    systemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : '',
    // Tolerate absent or hand-edited values: anything but the extend literal
    // means replace, so stored sections from earlier versions keep exactly
    // the behavior they were saved under.
    strategyMode: config.strategyMode === 'extend-default' ? 'extend-default' : 'replace-default',
    shortcut: typeof config.shortcut === 'string' ? config.shortcut : '',
    maxConcurrent: intInRange(config.maxConcurrent, 'maxConcurrent', 1, 16),
    rateLimitPerMinute: intInRange(config.rateLimitPerMinute, 'rateLimitPerMinute', 1, 600),
    streaming: typeof config.streaming === 'boolean' ? config.streaming : DEFAULT_CONFIG.streaming,
    contextAware: typeof config.contextAware === 'boolean' ? config.contextAware : DEFAULT_CONFIG.contextAware,
    contextMaxMessages: intInRange(config.contextMaxMessages, 'contextMaxMessages', 0, 50),
    contextMaxChars: intInRange(config.contextMaxChars, 'contextMaxChars', 0, 100000),
  }
}

/**
 * The effective system prompt. An empty override always means the built-in
 * strategy. A non-empty override follows `strategyMode`: `replace-default`
 * swaps the built-in strategy out entirely (its hard rules are not retained),
 * while `extend-default` appends the custom text after the built-in strategy,
 * so those rules stay in force. Tolerates an absent field (older stored
 * sections predate the schema default).
 * @param config - the resolved config.
 * @param builtin - the built-in strategy prompt.
 * @returns the system prompt of the next call.
 */
export function effectiveSystemPrompt(config: Config, builtin: string): string {
  const custom = (config.systemPrompt ?? '').trim()
  if (custom === '') return builtin
  if (config.strategyMode === 'extend-default') {
    return `${builtin}\n\nOperator additions (follow them where they do not conflict with the rules above):\n${custom}`
  }
  return custom
}
