/**
 * Host half of the prompt-enhance plugin: the `prompt-enhance` settings
 * section, the POST /prompt-enhance/enhance route (LLM call through
 * ctx.llm, route resolved by precedence: settings pair → session request
 * header → harness default model), and the /enhance slash command. The
 * browser half (exports "./client") contributes the composer button, the
 * preview panel, and the undo bar.
 *
 * Service contract — the honest table. Only `llm` is required; every other
 * capability is declared here so a future edit cannot quietly re-harden it:
 *
 * | service      | declared in `inject` | absent behaviour                      |
 * |--------------|----------------------|---------------------------------------|
 * | `llm`        | YES                  | the plugin does not activate          |
 * | `webServer`  | YES                  | the plugin does not activate          |
 * | `commands`   | no (`ctx.get`)       | no `/enhance`; the HTTP route remains |
 * | `sessions`   | no (`ctx.get`)       | route resolution drops that layer     |
 * | `settings`   | no (`ctx.inject`)    | composition entry keeps its values    |
 *
 * **`webServer` must stay in `inject`, even though the route code reads it
 * defensively.** An earlier change moved it out on the reasoning that
 * `registerEnhanceRoute` opens with `ctx.get('webServer')` and returns when
 * absent — i.e. that the body already "treated it as optional". That reasoning
 * was wrong: **`ctx.get` can only reach a service the plugin actually
 * injected**, so removing it from `inject` did not make the route optional, it
 * made the route IMPOSSIBLE. Both declarations then disagreed silently, and the
 * symptom appeared only in a real host:
 *
 *   inject = ['llm']              → POST /prompt-enhance/enhance → 405 Method Not Allowed
 *   inject = ['llm', 'webServer'] → POST /prompt-enhance/enhance → 200 application/json
 *
 * The 405 came from the web frontend's static route, which matches the path for
 * GET; the client then failed to parse HTML as JSON and reported "宿主服务返回了
 * 无法解析的响应". The defensive `ctx.get` remains correct and useful — it covers
 * a web server that mounts LATER, not one that is absent — but it is not a
 * licence to drop the declaration.
 * @module dsh-prompt-enhance
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, DEFAULT_CONFIG, PROMPT_ENHANCE_NAMESPACE, resolveConfig, type Config as PluginConfig } from './config'
import { registerEnhanceRoute } from './enhance-routes'
import { registerEnhanceCommand } from './enhance-command'

export const name = 'prompt-enhance'

/**
 * Required services: the model call and the HTTP surface.
 *
 * `webServer` is here because Cordis gates `ctx.get` on injection (see the module
 * doc) — declaring it is what MAKES it reachable. `llm` is read per request
 * through `ctx.get('llm')`, which only works for the same reason.
 */
export const inject = ['llm', 'webServer']

export { Config, DEFAULT_CONFIG, PROMPT_ENHANCE_NAMESPACE, resolveConfig } from './config'
export type { StrategyMode } from './config'
export { DEFAULT_SYSTEM_PROMPT, frameUserPrompt } from './prompts'
export { enhanceText, formatEnhanceError, resolveRoute, toEnhanceError } from './enhancer'
export type { EnhanceCallOptions, LlmStreamFace, RoutePair, UpstreamReason } from './enhancer'
export { normalizeOutput } from './shared/normalize'
export { checkInputText } from './shared/validate'
export { ENHANCE_ENDPOINT } from './shared/protocol'
export type { EnhanceError, EnhanceResult, EnhanceRequestBody, EnhanceResponse, EnhanceErrorCode } from './shared/protocol'

/**
 * Register the settings section across harness generations.
 *
 * `@deepseek-ai/dsh-settings` changed its public surface between the 0.1.1-rc
 * line and the 0.1.2-alpha line:
 * - rc (0.1.1-rc.x): standalone `installSettingsSection(ctx, ns, …)` plus the
 *   `settingsNamespace()` brand helper — both module exports;
 * - alpha (0.1.2-alpha.x): the same wiring moved onto the service as
 *   `ctx.settings.installSection(owner, ns, …)`, and the standalone exports
 *   were removed.
 *
 * A static named import of the removed exports is a load-time SyntaxError on
 * alpha, so this file must not statically import them. Instead the section is
 * registered through `ctx.inject(['settings'])` — the service-availability
 * gate both generations use internally — with a runtime probe picking the API
 * the mounted service actually speaks. The legacy path goes through a dynamic
 * import so the alpha build never evaluates the removed names.
 */
function installSettingsSectionCompat(ctx: Context, namespace: string, schema: unknown, entry: unknown, hooks: {
  setSource: (source: () => unknown) => void
  onChange: () => void
  validate: (value: unknown) => void
}): void {
  ctx.inject(['settings'], (settingsCtx: Context) => {
    const service = (settingsCtx as unknown as { settings?: { installSection?: unknown } }).settings
    if (typeof service?.installSection === 'function') {
      ;(service.installSection as (owner: Context, ns: string, schema: unknown, entry: unknown, hooks: unknown) => void)(
        ctx, namespace, schema, entry, hooks,
      )
      return
    }
    // Legacy rc line: resolve the standalone helpers lazily. The module itself
    // exists in every cohort; only its named exports differ, and rc.2 REMOVED
    // both — so the call goes through a structural view of the legacy surface
    // instead of the module's current types, which no longer declare them.
    // (Verified against the published tarballs: `installSettingsSection` and
    // `settingsNamespace` are real exports of 0.1.1-rc.2 and absent from
    // 0.1.7-rc.2.) The dynamic import keeps a cohort that never had them from
    // evaluating the names at load time, and the runtime probe decides.
    void import('@deepseek-ai/dsh-settings').then((mod) => {
      const legacy = mod as unknown as {
        installSettingsSection?: (owner: Context, ns: unknown, schema: unknown, entry: unknown, hooks: unknown) => void
        settingsNamespace?: (ns: string) => unknown
      }
      if (typeof legacy.installSettingsSection === 'function' && typeof legacy.settingsNamespace === 'function') {
        legacy.installSettingsSection(ctx, legacy.settingsNamespace(namespace), schema, entry, hooks)
      }
    }, () => {
      // Settings integration is optional by design; the plugin keeps working
      // on its composition entry when the module cannot be resolved at all.
    })
  })
}

/**
 * Mount the host half. The settings section layers over the composition
 * entry and is re-resolved per request, so Settings → 插件配置 changes reach
 * the very next call.
 *
 * The `prompt-enhance` form on that page comes from the `Config` export alone:
 * the loader mounts `unwrapExports(module)` and Cordis records `plugin.Config`
 * as the entry's runtime schema, which `dsh-settings` projects into a form.
 * There is no registration call to make — the earlier `installSettingsSection`
 * paths are dead on current hosts (`ctx.settings.installSection` does not exist
 * and `@deepseek-ai/dsh-settings` exports no `installSettingsSection`), and they
 * failed silently. Keeping the schema a named export is what keeps it visible.
 *
 * `llm` and `webServer` are the required services (both in `inject`). The
 * remaining capabilities this module wires are genuinely optional and probed at
 * their point of use, so an absent one costs that capability and nothing else:
 * `commands` (`/enhance`), `sessions` and `settings` (route resolution layers).
 * See the module doc for the full table and for why `webServer` cannot be
 * demoted to an optional probe.
 * @param ctx - registrant context.
 * @param config - deployment configuration (schema defaults filled by the loader).
 */
export function apply(ctx: Context, config: PluginConfig = { ...DEFAULT_CONFIG }): void {
  // A partial stored section leaves every absent key `undefined`, and a function
  // default parameter only fires when nothing was passed at all. Spread the
  // defaults underneath so a section that sets one field keeps the rest.
  let current: () => PluginConfig = () => ({ ...DEFAULT_CONFIG, ...(config ?? {}) })
  installSettingsSectionCompat(ctx, PROMPT_ENHANCE_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source as () => PluginConfig
    },
    onChange: () => {},
    validate: (value) => {
      resolveConfig(value as PluginConfig)
    },
  })
  // Run the raw settings through resolveConfig so the request path sees the
  // normalized form (trimmed provider/model, stripped legacy keys, validated
  // ranges) — the validate hook only refuses bad values, it never transforms.
  const readConfig = (): PluginConfig => resolveConfig(current())
  registerEnhanceRoute(ctx, readConfig)
  registerEnhanceCommand(ctx, readConfig)
}
