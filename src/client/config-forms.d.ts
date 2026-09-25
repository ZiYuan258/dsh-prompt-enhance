/**
 * Client-context augmentation for DSH 0.1.7-rc.1's `configForms` service.
 *
 * The published `@deepseek-ai/dsh-client-ui-settings` types this package
 * resolves to (`^0.1.1-rc.2`) still describe the pre-0.1.7 `settingsScope`
 * service, which the 0.1.7-rc.1 host no longer provides at runtime. The host
 * serves the configuration-form surface under `configForms` instead: the same
 * read/subscribe caller contract as `settingsScope.bind(...)` returned, framed
 * per Host plugin entry id (`get(entryId)`).
 *
 * Only the slice this client consumes is declared (mirror read + live
 * replacement subscription); the runtime shape is observable in
 * `@deepseek-ai/dsh-client-ui-settings/lib/client.js` (`ConfigForms` /
 * `ConfigFormController`).
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The DSH 0.1.7 host's configuration-form provider. */
    configForms: {
      /** Fetch the form (live read + write queue) owed to one Host plugin entry. */
      get(entryId: string): {
        /** The current sync snapshot (stable reference until the next change). */
        getSnapshot(): {
          status: 'loading' | 'ready' | 'unavailable'
          value: unknown
          writable: boolean
        }
        /** Observe snapshot replacements and unregister when the callback returns. */
        subscribe(listener: () => void): () => void
        /** Queue one field write; resolves once the Host has accepted it. */
        set(field: string, value: unknown): unknown
        /** Queue one field clear, resetting it to the schema default. */
        unset(field: string): unknown
      }
    }
  }
}

/**
 * The `settings.section` seat supplies no injected share this page can use.
 *
 * `SlotEntryDef.inject` is the CHILD-slot inject face an owner declares for the
 * children it renders (`SlotSpec`), not something a registrant adds to its own
 * props, so naming `configForms` there is rejected — and the shipped standard kit
 * for `settings.section` carries `t`/`renderSlot` only. The page therefore
 * receives the form through its own prop, handed over by `apply` at registration
 * time; see `SettingsPanel`'s `configForms` prop.
 */
export {}