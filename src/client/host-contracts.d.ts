/**
 * The plugin's own conversation-message source.
 *
 * `@deepseek-ai/dsh-llm`'s `MessageSourceMap` is merge-extensible on purpose —
 * its own doc calls it "merge-extensible", and shipped packages use that: for
 * example `@deepseek-ai/dsh-agent` contributes `'model-selection'`. A plugin that
 * publishes messages under its own producer identity is expected to declare that
 * identity here rather than reach for a cast.
 *
 * Why this is needed at all: `enhancer.ts` has always stamped its request with
 * `{ kind: 'plugin', plugin: 'dsh-prompt-enhance' }`, and the 0.1.7-rc.1 types
 * accepted it — the same expression is a type error against the 0.1.7-rc.2
 * declarations, which no longer carry a generic plugin source. The runtime value
 * is unchanged either way; this declaration is what makes the source honest to
 * the compiler instead of forcing an assertion.
 * @module dsh-prompt-enhance/client/host-contracts
 */

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    plugin: {
      kind: 'plugin'
      /** Package name of the plugin that produced the message. */
      plugin: string
    }
  }
}

export {}
