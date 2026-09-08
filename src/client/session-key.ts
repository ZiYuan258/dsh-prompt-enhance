/**
 * Stable per-composer session key for client UI state, with a dual-host
 * compatibility shim between dsh 0.1.1-rc.2 and 0.1.2-rc.1.
 *
 * The input slot owner share (`SessionStandardProps`) carried a `sessionId`
 * field on the 0.1.1-rc line, which this plugin used to key its panel, undo
 * stack, and shortcut target. The 0.1.2-rc line dropped that field from the
 * standard kit (the snapshot hooks `useConversation`/`useInput`/`inputActions`
 * remain) — so `props.sessionId` is simply absent at runtime there.
 *
 * The browser half must still key its module-level state per mounted composer,
 * so when the host id is missing we mint a stable per-mount id (one per
 * component instance, held in a ref). The server route receives the REAL id
 * only when the host provides it; otherwise it degrades to the harness default
 * model (`sessionRouteOf` undefined branch), which is the documented fallback.
 * @module dsh-prompt-enhance/client/session-key
 */

import { useRef } from 'react'

/** Monotonic source for per-mount fallback ids (module-scoped, never reset). */
let mountSeq = 0

/**
 * Resolve the id used to key client UI state for one mounted composer.
 * @param maybeSessionId - the host-provided `sessionId` prop; `undefined` on 0.1.2-rc.1.
 * @returns the host id when present, otherwise a stable per-mount fallback id.
 */
export function useSessionKey(maybeSessionId: string | undefined): string {
  const ref = useRef<string | undefined>(undefined)
  if (ref.current === undefined) {
    ref.current = maybeSessionId !== undefined && maybeSessionId !== '' ? maybeSessionId : `pe:${++mountSeq}`
  }
  return ref.current
}

/**
 * The id to send to the host route. Real when the host provides it; otherwise
 * `undefined` so the server falls back to the harness default model route.
 * @param maybeSessionId - the host-provided `sessionId` prop.
 * @returns the id to wire, or `undefined` when unknown.
 */
export function serverSessionId(maybeSessionId: string | undefined): string | undefined {
  return maybeSessionId !== undefined && maybeSessionId !== '' ? maybeSessionId : undefined
}
