/**
 * The POST /prompt-enhance/enhance host route: the browser half's single
 * seam. Loopback-fenced, body-capped, per-request config re-read (settings
 * changes land on the very next call), route resolved by precedence
 * (settings pair → session request header → harness default model).
 * @module dsh-prompt-enhance/enhance-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { ENHANCE_ENDPOINT, ENHANCE_STREAM_ENDPOINT, type EnhanceStreamEvent } from './shared/protocol'
import { createStreamNormalizer } from './shared/stream-text'
import { checkInputText } from './shared/validate'
import { type Config } from './config'
import { toEnhanceError } from './enhancer'
import { runEnhance, sessionRouteOf } from './orchestrate'
import { isTrustedRequest } from './loopback'
import { readBoundedJson, writeJson } from './http'

/** Envelope slack over the UTF-8 text cap: JSON quoting can inflate ~2-6x in the worst case. */
const bodyCapOf = (maxInputChars: number): number => maxInputChars * 6 + 4096

/** Per-mount admission state: sliding-window rate stamps + active-call count. */
interface AdmissionGate {
  stamps: number[]
  active: number
}

/**
 * Write one SSE frame. Payloads are JSON so a newline inside the text can
 * never break the framing.
 */
function writeEvent(res: ServerResponse, event: EnhanceStreamEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

/**
 * Open the SSE response. `no-transform` and `x-accel-buffering` keep proxies
 * from buffering the stream into one blob, which would defeat the point.
 */
function openStream(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  // A comment frame flushes the headers immediately so the client's reader
  // resumes before the first model token arrives.
  res.write(': open\n\n')
}

/**
 * Serve one enhance POST against the request envelope.
 * @param ctx - registrant context (llm, optional sessions/settings).
 * @param readConfig - per-request config reader.
 * @param req - the incoming request.
 * @param res - the outgoing response.
 * @param stream - whether to answer with an SSE stream of incremental frames
 *   instead of one JSON envelope. Both modes share the whole admission path;
 *   only the response shape differs.
 */
async function serveEnhance(ctx: Context, readConfig: () => Config, gate: AdmissionGate, req: IncomingMessage, res: ServerResponse, stream: boolean): Promise<void> {
  if (!isTrustedRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'internal', message: 'forbidden: loopback-only' } })
    return
  }
  // One route, two exact endpoints (one-shot JSON / incremental SSE):
  // anything else under the prefix is unknown.
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (pathname !== ENHANCE_ENDPOINT && pathname !== ENHANCE_STREAM_ENDPOINT) {
    writeJson(res, 404, { ok: false, error: { code: 'internal', message: 'not found' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'internal', message: 'only POST is allowed' } })
    return
  }
  const contentType = req.headers['content-type']
  if (contentType !== undefined && !String(contentType).toLowerCase().startsWith('application/json')) {
    writeJson(res, 415, { ok: false, error: { code: 'rejected', message: '仅支持 application/json 请求体。' } })
    return
  }
  let config: Config
  try {
    config = readConfig()
  } catch (error) {
    // resolveConfig fails loud on an invalid section — surface it instead of
    // letting the rejection escape the handler.
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: `prompt-enhance 配置无效：${error instanceof Error ? error.message : String(error)}` } })
    return
  }
  // Fail before reading the body when the plugin is switched off.
  if (!config.enabled) {
    writeJson(res, 403, { ok: false, error: { code: 'rejected', message: '提示词增强已在设置中关闭。' } })
    return
  }
  // Fast reject on a declared body that already exceeds the cap: refuse before
  // reading a single byte. The streamed cap inside readBoundedJson stays as the
  // backstop for chunked bodies, which carry no Content-Length at all. A caller
  // that declares megabytes and dribbles them (or never sends them) must not
  // hold the connection open, so the socket is destroyed once the 413 lands.
  const cap = bodyCapOf(config.maxInputChars)
  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > cap) {
    res.once('finish', () => res.socket?.destroy())
    writeJson(res, 413, { ok: false, error: { code: 'rejected', message: '请求体超过大小上限。' } })
    return
  }
  let body: unknown
  try {
    body = await readBoundedJson(req, cap)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body too large'
    writeJson(res, tooLarge ? 413 : 422, {
      ok: false,
      error: { code: 'rejected', message: tooLarge ? '请求体超过大小上限。' : '请求体不是有效的 JSON。' },
    })
    return
  }
  const record = body as { sessionId?: unknown; text?: unknown } | null
  if (record === null || typeof record !== 'object' || typeof record.text !== 'string') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: '请求体必须是 { sessionId?, text } JSON。' } })
    return
  }
  const sessionId = typeof record.sessionId === 'string' && record.sessionId !== '' ? record.sessionId : undefined
  const check = checkInputText(record.text, config.maxInputChars)
  if (!check.ok) {
    // The over-length case carries structured counts so the client renders
    // its localized too-long message (matching the client-side guard);
    // empty text (server-side only — the client guards it first) stays generic.
    writeJson(res, 422, {
      ok: false,
      error: check.code === 'too-long'
        ? { code: 'rejected', params: { count: check.count, max: check.max } }
        : { code: 'rejected' },
    })
    return
  }
  // Admission gate (after validation, so only real calls consume budget):
  // sliding-window rate cap, then concurrency cap. Rejected calls answer 429
  // with the configured limits so the user can act.
  //
  // The rate window counts SUCCESSFUL calls only — a stamp lands after the
  // 200 has been written, never on failure. Counting attempts instead would
  // burn the user's window on a run of timeouts/upstream errors and lock
  // them out right when the model recovers. The concurrency cap below still
  // bounds in-flight calls regardless of outcome, so failed calls cannot be
  // used to hammer the upstream either.
  const now = Date.now()
  // Trim the window in one splice instead of a `while (shift)` loop: with the
  // configured cap at 600 the worst case drops from O(N²) array shifts to a
  // single O(N) relocation. The cap is bounded, so this stays cheap in
  // absolute terms; the point is to avoid the quadratic shape on every call.
  const stamps = gate.stamps
  const cut = now - 60000
  let validFrom = 0
  while (validFrom < stamps.length && (stamps[validFrom] ?? cut) < cut) validFrom++
  if (validFrom > 0) stamps.splice(0, validFrom)
  if (stamps.length >= config.rateLimitPerMinute) {
    // The window is bounded, so the oldest surviving stamp tells exactly when
    // a slot frees up — advertise it instead of making the user guess.
    const oldest = stamps[0] ?? now
    const retryAfterSeconds = Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000))
    res.setHeader('Retry-After', String(retryAfterSeconds))
    writeJson(res, 429, {
      ok: false,
      error: { code: 'rate-limit', params: { limit: config.rateLimitPerMinute, retryAfterSeconds } },
    })
    return
  }
  // No Retry-After here: a busy slot frees whenever some in-flight call
  // settles, which is not a delay this route can predict.
  if (gate.active >= config.maxConcurrent) {
    writeJson(res, 429, {
      ok: false,
      error: { code: 'concurrency-limit', params: { max: config.maxConcurrent } },
    })
    return
  }
  gate.active += 1
  // Cancel the model call when the browser goes away mid-flight. `res.close`
  // also fires after a normal response completes, so guard with
  // `writableEnded` — only a premature close aborts the call.
  const callerAbort = new AbortController()
  const onConnectionClosed = (): void => {
    if (!res.writableEnded) callerAbort.abort()
  }
  res.on('close', onConnectionClosed)
  try {
    const runOptions = {
      text: record.text,
      sessionRoute: sessionRouteOf(ctx, sessionId),
      signal: callerAbort.signal,
      ...sessionId !== undefined ? { sessionId } : {},
    }
    if (stream) {
      // The stream already opens before the model call, so the client sees
      // the first token instead of waiting for the whole rewrite.
      openStream(res)
      // Display-only normalization: withhold a fence the final body will not
      // have. The authoritative text still comes from `normalizeOutput` at
      // the end, so this cannot change what the user applies.
      const display = createStreamNormalizer()
      const value = await runEnhance(ctx, config, {
        ...runOptions,
        onDelta: (delta: string): void => {
          const safe = display.push(delta)
          if (safe !== '' && !res.writableEnded) writeEvent(res, { type: 'delta', text: safe })
        },
      })
      if (!res.writableEnded) {
        writeEvent(res, { type: 'done', value })
        // Close the response from the server side. The client stops reading on
        // `done`, but an un-ended SSE response leaves the connection open until
        // the socket times out, and an intermediary that buffers until the
        // response completes would hold the whole rewrite back — the opposite of
        // what this branch exists for. The stream's lifetime belongs to the
        // protocol, not to the client remembering to cancel.
        res.end()
      }
    } else {
      const value = await runEnhance(ctx, config, runOptions)
      writeJson(res, 200, { ok: true, value })
    }
    // Count only on success: failed calls must not consume the sliding window
    // (see the gate note above). `Date.now()` at completion, not admission,
    // keeps the window honest — a slow success still counts as one call.
    stamps.push(Date.now())
  } catch (error) {
    const wire = toEnhanceError(error)
    if (stream && res.headersSent) {
      // Headers are already out: the failure has to ride the same stream, and
      // the stream must be closed here for the same reason the success path
      // closes it — the client is waiting on a protocol end, not on a timeout.
      if (!res.writableEnded) {
        writeEvent(res, { type: 'error', error: wire })
        res.end()
      }
    } else {
      writeJson(res, wire.code === 'timeout' ? 504 : wire.code === 'unconfigured' ? 409 : 502, { ok: false, error: wire })
    }
  } finally {
    res.off('close', onConnectionClosed)
    gate.active -= 1
  }
}

/**
 * Contexts that already own the route. The admission gate is created per
 * registration, so mounting twice on one context would silently double the
 * effective limits — exactly the drift a re-applied plugin (reload, re-link)
 * must not introduce. Re-applying reuses the first mount instead.
 */
const mountedContexts = new WeakSet<Context>()

/**
 * Register the /prompt-enhance prefix route on the shared webserver. A second
 * registration on the same context is ignored.
 *
 * The defensive `ctx.get('webServer')` covers a web server that mounts LATER (or
 * one this plugin's fiber cannot see), not one that is absent: **`ctx.get` can
 * only reach a service the plugin injected**, so `webServer` must stay in the
 * plugin's `inject` list. Dropping it there made this function return early on
 * every host — the route silently vanished and the path fell through to the web
 * frontend's static handler, which answers `405 Method Not Allowed` for a POST,
 * which the browser then fails to parse as JSON. Keep the guard; keep the
 * declaration.
 * @param ctx - registrant context.
 * @param readConfig - per-request config reader so settings changes apply immediately.
 */
export function registerEnhanceRoute(ctx: Context, readConfig: () => Config): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  if (mountedContexts.has(ctx)) return
  mountedContexts.add(ctx)
  const gate: AdmissionGate = { stamps: [], active: 0 }
  webserver.register({
    kind: 'prefix',
    path: ENHANCE_ENDPOINT.replace(/\/enhance$/, ''),
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      return serveEnhance(ctx, readConfig, gate, req, res, pathname === ENHANCE_STREAM_ENDPOINT)
    },
  })
}
