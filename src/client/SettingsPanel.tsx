/**
 * The plugin's own page under Settings (the `settings.section` seat): every
 * config field rendered from one descriptor table, read through the host's
 * `configForms` form and written back per field.
 *
 * Why this file exists: the plugin's schema has been served by the host all
 * along, but a DSH plugin gets no Settings UI for free. The Plugins page only
 * shows a configure control for a package whose client half registers
 * `plugins.row.config`, and a nav entry only for one that registers
 * `settings.section`. Neither existed, so the configuration was unreachable
 * from the GUI — editable only by hand-editing the profile patch.
 *
 * One descriptor per field is the single source of truth for the form: the
 * label/help locale keys, the control, and the value coercion. A field added to
 * the host config without a descriptor here simply does not render, which is the
 * safe direction (no half-wired control).
 * @module dsh-prompt-enhance/client/SettingsPanel
 */

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptEnhanceKey } from './locales'
import type { Config } from '../config'

/**
 * The slice of the host's `ConfigFormController` this panel consumes.
 * Structural on purpose: the panel is unit-tested against a stub, and the real
 * service is reached through the client context.
 */
export interface ConfigFormLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value?: unknown
    revision?: number
    writable?: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): unknown
  unset(field: string): unknown
}

/** How one field renders and how its draft value is coerced. */
type FieldKind = 'boolean' | 'number' | 'text' | 'textArea' | 'enum'

/** One row of the form. */
interface FieldSpec {
  /** Config key, also the `configForms` field name. */
  key: keyof Config
  kind: FieldKind
  /** Locale key suffix: `field.<slug>.label` / `field.<slug>.help`. */
  slug: string
  /** Allowed values of an `enum` field, in menu order. */
  options?: readonly string[]
  /** Numeric bounds, mirrored from the host schema for local validation. */
  min?: number
  max?: number
}

/**
 * The form, in reading order. Bounds are duplicated from `src/config.ts` on
 * purpose: the panel refuses an out-of-range edit locally so the user sees the
 * problem at the control, and the host still validates independently.
 */
const FIELDS: readonly FieldSpec[] = [
  { key: 'enabled', kind: 'boolean', slug: 'enabled' },
  { key: 'reasoningEffort', kind: 'enum', slug: 'reasoningEffort', options: ['off', 'low', 'high', 'inherit'] },
  { key: 'maxOutputTokens', kind: 'number', slug: 'maxOutputTokens', min: 256, max: 65536 },
  { key: 'maxInputChars', kind: 'number', slug: 'maxInputChars', min: 200, max: 200000 },
  { key: 'temperature', kind: 'number', slug: 'temperature', min: 0, max: 1 },
  { key: 'timeoutMs', kind: 'number', slug: 'timeoutMs', min: 5000, max: 600000 },
  { key: 'streaming', kind: 'boolean', slug: 'streaming' },
  { key: 'contextAware', kind: 'boolean', slug: 'contextAware' },
  { key: 'contextMaxMessages', kind: 'number', slug: 'contextMaxMessages', min: 0, max: 50 },
  { key: 'contextMaxChars', kind: 'number', slug: 'contextMaxChars', min: 0, max: 100000 },
  { key: 'provider', kind: 'text', slug: 'provider' },
  { key: 'model', kind: 'text', slug: 'model' },
  { key: 'shortcut', kind: 'text', slug: 'shortcut' },
  { key: 'maxConcurrent', kind: 'number', slug: 'maxConcurrent', min: 1, max: 16 },
  { key: 'rateLimitPerMinute', kind: 'number', slug: 'rateLimitPerMinute', min: 1, max: 600 },
  { key: 'strategyMode', kind: 'enum', slug: 'strategyMode', options: ['replace-default', 'extend-default'] },
  { key: 'systemPrompt', kind: 'textArea', slug: 'systemPrompt' },
]

/**
 * Props the seat supplies, plus the form this page edits.
 *
 * `configForms` and `entryId` are NOT slot-injected: the `settings.section`
 * standard kit carries only `t`/`renderSlot`, and `SlotEntryDef.inject` describes
 * a child-slot face rather than a registrant's own props. `apply` hands both over
 * at registration time, which keeps the component's props fully typed.
 */
export type SettingsPanelProps = PropsRuntime<'settings.section'> & PropsLocale<'prompt-enhance'> & {
  /** The host's configuration-form service, resolved once in `apply`. */
  configForms: { get(entryId: string): ConfigFormLike }
  /**
   * Entry id whose form this page edits. The host keys forms by profile entry
   * id, which for a bundle row is the bare row id (`prompt-enhance`), not the
   * composed `include:` id.
   */
  entryId: string
}

/** One enum option's locale key, e.g. `field.reasoningEffort.option.off`. */
function optionKey(slug: string, option: string): PromptEnhanceKey {
  return `field.${slug}.option.${option}` as PromptEnhanceKey
}

/** The label locale key of one field. */
function labelKey(slug: string): PromptEnhanceKey {
  return `field.${slug}.label` as PromptEnhanceKey
}

/** The help locale key of one field. */
function helpKey(slug: string): PromptEnhanceKey {
  return `field.${slug}.help` as PromptEnhanceKey
}

/** Whether the dictionary actually carries a key (help text is optional). */
function hasKey(t: SettingsPanelProps['t'], key: PromptEnhanceKey): boolean {
  // A missing key resolves to the key itself in this locale layer, so presence
  // is detected by round-tripping rather than by reaching into the dictionary.
  return t(key) !== key
}

/**
 * Coerce one raw input value for its field, or reject it.
 * @param spec - the field being edited.
 * @param raw - the control's string/boolean value.
 * @returns the value to write, or undefined when it is not acceptable yet.
 */
function coerce(spec: FieldSpec, raw: string | boolean): unknown {
  if (spec.kind === 'boolean') return raw === true || raw === 'true'
  const text = String(raw)
  if (spec.kind === 'text' || spec.kind === 'textArea' || spec.kind === 'enum') return text
  if (text.trim() === '') return undefined
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return undefined
  if (spec.min !== undefined && parsed < spec.min) return undefined
  if (spec.max !== undefined && parsed > spec.max) return undefined
  return Number.isInteger(parsed) ? parsed : parsed
}

/** One settings page for the prompt-enhance plugin. */
export function SettingsPanel(props: SettingsPanelProps): ReactNode {
  const { t, configForms, entryId } = props
  const form = useMemo(() => configForms.get(entryId), [configForms, entryId])
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => form.subscribe(listener), [form]),
    useCallback(() => form.getSnapshot(), [form]),
  )
  // Local drafts keyed by field, so typing does not write on every keystroke.
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({})
  const [error, setError] = useState<string | undefined>(undefined)

  const value = (snapshot.value ?? {}) as Partial<Record<string, unknown>>

  /** The value a control shows: the local draft, else the resolved setting. */
  const shown = (spec: FieldSpec): string | boolean => {
    const draft = drafts[spec.key]
    if (draft !== undefined) return draft
    const current = value[spec.key]
    if (spec.kind === 'boolean') return current === true
    if (current === undefined || current === null) return ''
    return String(current)
  }

  /** Commit one field to the host, or report why it was refused. */
  const commit = (spec: FieldSpec): void => {
    const draft = drafts[spec.key]
    if (draft === undefined) return
    const next = coerce(spec, draft)
    if (next === undefined) {
      setError(t('settings.invalid', { field: t(labelKey(spec.slug)) }))
      return
    }
    setError(undefined)
    void form.set(spec.key, next)
  }

  /** Reset one field to the schema default (clears the stored override). */
  const reset = (spec: FieldSpec): void => {
    setError(undefined)
    setDrafts((current) => {
      const next = { ...current }
      delete next[spec.key]
      return next
    })
    void form.unset(spec.key)
  }

  const edit = (spec: FieldSpec, raw: string | boolean): void => {
    setDrafts((current) => ({ ...current, [spec.key]: raw }))
    // Booleans and selects read better committing immediately: there is no
    // "half-typed" state to preserve, and a stale switch is a correctness bug.
    if (spec.kind === 'boolean' || spec.kind === 'enum') {
      const next = coerce(spec, raw)
      if (next !== undefined) {
        setError(undefined)
        void form.set(spec.key, next)
        setDrafts((current) => {
          const rest = { ...current }
          delete rest[spec.key]
          return rest
        })
      }
    }
  }

  if (snapshot.status === 'unavailable') {
    return <div className="dsh-pe-settings-note">{t('settings.unavailable')}</div>
  }
  if (snapshot.status === 'loading') {
    return <div className="dsh-pe-settings-note">{t('settings.loading')}</div>
  }

  const writable = snapshot.writable !== false

  return (
    <div className="dsh-pe-settings">
      <p className="dsh-pe-settings-intro">{t('settings.intro')}</p>
      {error !== undefined && <div className="dsh-pe-settings-error">{error}</div>}
      <div className="dsh-pe-settings-fields">
        {FIELDS.map((spec) => {
          const control = shown(spec)
          const disabled = !writable
          return (
            <div className="dsh-pe-field" key={spec.key}>
              <div className="dsh-pe-field-head">
                <label className="dsh-pe-field-label" htmlFor={`dsh-pe-field-${spec.key}`}>
                  {t(labelKey(spec.slug))}
                </label>
                {hasKey(t, helpKey(spec.slug)) && (
                  <p className="dsh-pe-field-help">{t(helpKey(spec.slug))}</p>
                )}
              </div>
              <div className="dsh-pe-field-control">
                {spec.kind === 'boolean' && (
                  <input
                    id={`dsh-pe-field-${spec.key}`}
                    type="checkbox"
                    checked={control === true}
                    disabled={disabled}
                    onChange={(event) => edit(spec, event.target.checked)}
                  />
                )}
                {spec.kind === 'enum' && (
                  <select
                    id={`dsh-pe-field-${spec.key}`}
                    value={String(control)}
                    disabled={disabled}
                    onChange={(event) => edit(spec, event.target.value)}
                  >
                    {(spec.options ?? []).map((option) => (
                      <option key={option} value={option}>{t(optionKey(spec.slug, option))}</option>
                    ))}
                  </select>
                )}
                {(spec.kind === 'text' || spec.kind === 'number') && (
                  <input
                    id={`dsh-pe-field-${spec.key}`}
                    type={spec.kind === 'number' ? 'number' : 'text'}
                    value={String(control)}
                    disabled={disabled}
                    min={spec.min}
                    max={spec.max}
                    onChange={(event) => setDrafts((current) => ({ ...current, [spec.key]: event.target.value }))}
                    onBlur={() => commit(spec)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(spec)
                    }}
                  />
                )}
                {spec.kind === 'textArea' && (
                  <textarea
                    id={`dsh-pe-field-${spec.key}`}
                    value={String(control)}
                    disabled={disabled}
                    rows={4}
                    onChange={(event) => setDrafts((current) => ({ ...current, [spec.key]: event.target.value }))}
                    onBlur={() => commit(spec)}
                  />
                )}
                <button
                  type="button"
                  className="dsh-pe-field-reset"
                  disabled={disabled}
                  onClick={() => reset(spec)}
                >
                  {t('settings.reset')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
