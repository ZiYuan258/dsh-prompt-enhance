// @vitest-environment jsdom
/**
 * Tests of the plugin's own Settings page (`settings.section`).
 *
 * The page is a thin reader/writer over the host's `configForms` form, so the
 * form is stubbed and the assertions cover the contract that matters: which
 * value each control shows, what a commit sends, what a reset sends, and that an
 * out-of-range edit is refused locally instead of reaching the host.
 * @module tests/settings-panel
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SettingsPanel, type ConfigFormLike } from '../src/client/SettingsPanel'
import { zh } from '../src/client/locales'

const t = ((key: string, params?: Record<string, unknown>): string => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.split(`{${name}}`).join(String(value))
  return text
}) as TranslateNS<'prompt-enhance'>

/** A stub of the host form: a synchronous snapshot plus recorded writes. */
function stubForm(value: Record<string, unknown>, options: { status?: 'ready' | 'loading' | 'unavailable'; writable?: boolean } = {}) {
  const listeners = new Set<() => void>()
  let snapshot = {
    status: options.status ?? 'ready' as 'ready' | 'loading' | 'unavailable',
    value,
    revision: 1,
    writable: options.writable ?? true,
  }
  const set = vi.fn()
  const unset = vi.fn()
  const form: ConfigFormLike = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set,
    unset,
  }
  return {
    form,
    set,
    unset,
    /** Publish a new resolved section, as a host write would. */
    publish(next: Record<string, unknown>): void {
      snapshot = { ...snapshot, value: next }
      act(() => {
        for (const listener of listeners) listener()
      })
    },
  }
}

function renderPanel(form: ConfigFormLike): void {
  render(<SettingsPanel t={t} configForms={{ get: () => form }} entryId="prompt-enhance" />)
}

/** The control of one field, located by its visible label. */
const controlOf = (labelKey: keyof typeof zh): HTMLElement =>
  document.getElementById(`dsh-pe-field-${labelKey}`) as HTMLElement

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(cleanup)

describe('SettingsPanel', () => {
  it('renders the resolved values for every descriptor field', () => {
    const { form } = stubForm({ enabled: true, reasoningEffort: 'off', maxOutputTokens: 8192, shortcut: 'ctrl+alt+e' })
    renderPanel(form)
    expect((controlOf('enabled') as HTMLInputElement).checked).toBe(true)
    expect((controlOf('reasoningEffort') as HTMLSelectElement).value).toBe('off')
    expect((controlOf('maxOutputTokens') as HTMLInputElement).value).toBe('8192')
    expect((controlOf('shortcut') as HTMLInputElement).value).toBe('ctrl+alt+e')
  })

  it('labels every control with its own locale string', () => {
    const { form } = stubForm({})
    renderPanel(form)
    expect(screen.getByText(zh['field.reasoningEffort.label'])).toBeTruthy()
    expect(screen.getByText(zh['field.maxOutputTokens.help'])).toBeTruthy()
  })

  // A switch or a select has no half-typed state, so committing on change keeps
  // the UI from showing a value the host does not have.
  it('commits a boolean immediately', () => {
    const { form, set } = stubForm({ enabled: true })
    renderPanel(form)
    fireEvent.click(controlOf('enabled'))
    expect(set).toHaveBeenCalledWith('enabled', false)
  })

  it('commits an enum immediately', () => {
    const { form, set } = stubForm({ reasoningEffort: 'off' })
    renderPanel(form)
    fireEvent.change(controlOf('reasoningEffort'), { target: { value: 'low' } })
    expect(set).toHaveBeenCalledWith('reasoningEffort', 'low')
  })

  // Text and numbers keep a draft so typing does not write per keystroke.
  it('commits a text field on blur, not per keystroke', () => {
    const { form, set } = stubForm({ shortcut: '' })
    renderPanel(form)
    const input = controlOf('shortcut') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ctrl+alt+k' } })
    expect(set).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(set).toHaveBeenCalledWith('shortcut', 'ctrl+alt+k')
  })

  it('commits a number field as a number', () => {
    const { form, set } = stubForm({ maxOutputTokens: 8192 })
    renderPanel(form)
    const input = controlOf('maxOutputTokens') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12000' } })
    fireEvent.blur(input)
    expect(set).toHaveBeenCalledWith('maxOutputTokens', 12000)
  })

  // Bounds are duplicated from the host schema so the user is told at the
  // control; sending the value anyway would let the host reject it silently.
  it('refuses an out-of-range number and reports it', () => {
    const { form, set } = stubForm({ maxOutputTokens: 8192 })
    renderPanel(form)
    const input = controlOf('maxOutputTokens') as HTMLInputElement
    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.blur(input)
    expect(set).not.toHaveBeenCalled()
    expect(screen.getByText(zh['settings.invalid'].replace('{field}', zh['field.maxOutputTokens.label']))).toBeTruthy()
  })

  it('sends unset when a field is reset to its default', () => {
    const { form, unset } = stubForm({ shortcut: 'ctrl+alt+e' })
    renderPanel(form)
    const field = controlOf('shortcut').closest('.dsh-pe-field') as HTMLElement
    fireEvent.click(field.querySelector('.dsh-pe-field-reset') as HTMLElement)
    expect(unset).toHaveBeenCalledWith('shortcut')
  })

  it('reports an unavailable form instead of rendering dead controls', () => {
    const { form } = stubForm({}, { status: 'unavailable' })
    renderPanel(form)
    expect(screen.getByText(zh['settings.unavailable'])).toBeTruthy()
    expect(document.getElementById('dsh-pe-field-enabled')).toBeNull()
  })

  it('disables every control when the host reports the form read-only', () => {
    const { form } = stubForm({ enabled: true }, { writable: false })
    renderPanel(form)
    expect((controlOf('enabled') as HTMLInputElement).disabled).toBe(true)
    expect((controlOf('reasoningEffort') as HTMLSelectElement).disabled).toBe(true)
  })

  // The page must follow host-side changes (another window, a config reload).
  it('follows a host-side value change pushed through subscribe', () => {
    const { form, publish } = stubForm({ maxOutputTokens: 8192 })
    renderPanel(form)
    publish({ maxOutputTokens: 16000 })
    expect((controlOf('maxOutputTokens') as HTMLInputElement).value).toBe('16000')
  })
})
