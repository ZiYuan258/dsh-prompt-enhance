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
 * | service      | requirement                | absent behaviour                     |
 * |--------------|----------------------------|--------------------------------------|
 * | `llm`        | REQUIRED (inject)          | the plugin does not activate         |
 * | `webServer`  | optional (`ctx.get`)       | no HTTP route; `/enhance` still works |
 * | `commands`   | optional (`ctx.get`)       | no `/enhance`; the route still works  |
 * | `sessions`   | optional (`ctx.get`)       | route resolution drops that layer     |
 * | `settings`   | optional (`ctx.inject`)    | composition entry keeps its values    |
 *
 * `webServer` in particular must NOT return to `inject`: a non-web composition
 * (headless, ACP, a bare spine) has no web server, and making it required keeps
 * the whole plugin — including the `/enhance` command plane and the settings
 * schema, neither of which serves HTTP — in `pending (waiting for service:
 * webServer)` forever. `registerEnhanceRoute` already treats it as optional, so
 * a hard declaration was the inconsistency, not the fix.
 * @module dsh-prompt-enhance
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, DEFAULT_CONFIG, PROMPT_ENHANCE_NAMESPACE, resolveConfig, type Config as PluginConfig } from './config'
import { registerEnhanceRoute } from './enhance-routes'
import { registerEnhanceCommand } from './enhance-command'

export const name = 'prompt-enhance'

/**
 * Required services. `llm` is the enhancement itself and the only hard
 * dependency; everything else is probed at the point of use (see the table in
 * the module doc), so the plugin activates in any composition that can call a
 * model — including ones with no HTTP surface at all.
 */
export const inject = ['llm']

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
 * `llm` is the only required service (it is what `inject` declares). Every other
 * capability this module wires is optional and probed at its point of use, so an
 * absent one costs that capability and nothing else — `webServer` (HTTP route,
 * probed inside `registerEnhanceRoute`), `commands` (`/enhance`), `sessions` and
 * `settings` (route resolution layers). See the module doc for the full table.
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
