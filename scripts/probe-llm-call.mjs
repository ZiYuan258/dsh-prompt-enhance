/**
 * Diagnostic probe: reproduce the plugin's exact LLM call inside the real host
 * module graph, and print the RAW failure instead of the plugin's localized
 * "模型服务返回错误" line.
 *
 * Rationale: the plugin logs with console.info, which never reaches
 * %APPDATA%\DSH Desktop\logs, so the provider's underlying error is otherwise
 * invisible. This probe builds the identical GenerateOptions
 * (`createUserMessage` + the same content shape) and iterates the same
 * `llm.stream()` surface, printing every chunk and the terminal failure.
 *
 * It also reports token usage per reasoning effort, which is how the shipped
 * default (`reasoningEffort: off`) was chosen: on deepseek-flash one ordinary
 * draft cost 252 output tokens at `off` versus 2897 at the model's default
 * `high`.
 *
 * Run it through a one-boot overlay so it mounts as a loader row without ever
 * entering the profile — see scripts/probe-llm-call.patch.yml, whose file URL
 * must be pointed at this checkout first. The row has to sit under the profile's
 * resolution root for the `@deepseek-ai/dsh-llm` import to resolve.
 * @module dsh-prompt-enhance/scripts/probe-llm-call
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

const NAME = 'probe-llm-call'

/** Describe any thrown value without losing non-Error shapes. */
function describe(error) {
  if (error instanceof Error) {
    const extra = {}
    for (const key of ['code', 'status', 'failure', 'cause', 'detail']) {
      if (error[key] !== undefined) extra[key] = error[key]
    }
    return `${error.name}: ${error.message}${Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ''}`
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export default class ProbeLlmCall {
  static inject = ['llm']

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - injected context (has `llm`).
   * @param {object} config - the row config: provider/model/reasoningEffort.
   */
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = config
    // Defer past the rest of the boot so every adapter has registered.
    setTimeout(() => { void this.run() }, 2500)
  }

  /** Resolve the route the same way the plugin does, then make one call. */
  async run() {
    const out = (line) => process.stdout.write(`${NAME}: ${line}\n`)
    try {
      const llm = this.ctx.get('llm')
      if (llm === undefined) { out('FAIL no llm service'); return }

      let provider = this.config.provider
      let model = this.config.model
      if (provider === undefined || model === undefined) {
        const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
        out(`agentDefaultModel.currentSelection() -> ${describe(selection)}`)
        provider = selection?.provider
        model = selection?.model
      }
      out(`route -> provider=${provider} model=${model}`)

      const providers = llm.listProviders()
      out(`registered providers -> ${describe(providers)}`)

      // What does this exact route advertise? Reasoning support decides whether
      // an explicit effort can bound the reasoning budget.
      try {
        const info = await llm.resolveModelInfo(provider, model)
        out(`resolveModelInfo -> ${describe({ context: info.context, defaultMaxTokens: info.defaultMaxTokens, reasoning: info.reasoning?.efforts?.map((e) => e.id), defaultEffort: info.reasoning?.defaultEffort })}`)
      } catch (error) {
        out(`resolveModelInfo threw -> ${describe(error)}`)
      }

      // Compare reasoning efforts at a fixed budget, using a realistic draft.
      // `off` is included deliberately: an auxiliary rewrite does not need deep
      // reasoning, and this is the setting that decides the bill.
      const draft = this.config.draft
        ?? '帮我看看这个插件为什么老是报错，我觉得可能是接口变了，你顺便把错误处理也改一下，加上重试，还有日志要清楚一点'
      for (const effort of ['off', 'low', 'high', 'max']) {
        await this.attempt(out, llm, {
          label: `effort=${effort}`,
          provider,
          model,
          system: 'You rewrite drafts into structured prompts.',
          extra: { reasoningEffort: effort },
          input: draft,
        })
      }
      out('RESULT ok')
    } catch (error) {
      out(`RESULT threw -> ${describe(error)}`)
      if (error instanceof Error && error.stack !== undefined) out(`stack -> ${error.stack.split('\n').slice(0, 6).join(' | ')}`)
    }
  }

  /**
   * One streamed call with the plugin's exact message construction, reporting
   * the token usage so the cost of each variant is comparable.
   * @param out - line sink.
   * @param llm - the llm service.
   * @param options - route plus the variant under test.
   */
  async attempt(out, llm, options) {
    // `input` lets the caller substitute the real plugin prompt (with or without
    // the conversation-context block) so the measurement matches production.
    const text = options.input ?? '把这句话改写成结构化提示词：测试一下'
    const messages = [
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-prompt-enhance' },
      }),
    ]
    const generate = {
      provider: options.provider,
      model: options.model,
      system: options.system,
      messages,
      temperature: 0.3,
      maxTokens: 8192,
      signal: new AbortController().signal,
      ...options.extra,
    }
    const assembler = new BlockAssembler()
    try {
      const iterator = llm.stream(generate)[Symbol.asyncIterator]()
      let chunks = 0
      let usage
      for (;;) {
        const next = await iterator.next()
        if (next.done) break
        chunks += 1
        if (next.value.type === 'usage') usage = next.value.usage
        assembler.push(next.value)
      }
      const blocks = assembler.blocks()
      const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
      out(
        `${options.label ?? ''} finish=${describe(assembler.finish)} chunks=${chunks} `
        + `blockTypes=${describe(blocks.map((block) => block.type))} textChars=${text.length}`,
      )
      out(`   usage=${describe(usage)}`)
    } catch (error) {
      out(`${options.label ?? ''} THREW -> ${describe(error)}`)
    }
  }
}
