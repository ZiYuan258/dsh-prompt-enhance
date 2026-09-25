# Changelog

All notable changes are documented here. Versions follow the fork's own numbering from 0.3.0 on — npm carries the upstream `dsh-prompt-enhance`, so these numbers are not published there. Apache-2.0 attribution and the list of modified files live in [README.md](./README.md).

## 0.3.0 (2026-09-26)

Fork maintenance release. Makes the 0.2.1 tree work on DSH **0.1.7-rc.1**, which
the upstream baseline (`dsh >= 0.1.1-rc.2`) predates. Four of these are hard
failures on that host, and all four were silent — the plugin either took the
whole composer down or collapsed every specific error into one generic line.

> **Compatibility, stated precisely — two different claims.**
>
> - **Validated on DSH 0.1.7-rc.1.** The drift below was read off that live host
>   through Cordis Inspect and reproduced against it.
> - **Compiled and tested against DSH 0.1.7-rc.2.** Every `@deepseek-ai/dsh-*`
>   devDependency is pinned to `0.1.7-rc.2`, so typecheck and the full suite run
>   against that API surface. This is **not** "validated on rc.2": the fork has
>   not been run on an rc.2 host. That is the remaining step, and it needs the
>   installed DSH upgraded rather than more unit tests.
>
> Crediting rc.2 with real value: raising the baseline **found four genuine type
> drifts** that rc.1's thinner published types hid — rc.2 ships `lib/types` for
> every package, and three of them were needed as devDependencies before the
> plugin's own contract checked out (details under "Baseline" below).

**Fixed — the composer button crashed the input box.** `InputState.imageIds` was
renamed to `attachmentIds` with no alias, so `state.imageIds.length` threw
`undefined.length` and killed the composer alongside it. Every draft-state read is
now optional-chained and accepts both names, so a rename degrades to 0 instead of
throwing. (`src/client/EnhanceButton.tsx`)

**Fixed — every enhancement failed.** Route resolution read the harness default
model through `ctx.get('settings')?.get('agent-default-model')`; the current
`settings` service exposes `configure/prepareDocument/describe/update/replace/mutate`
and no `get`, so the call threw `ctx.get(...)?.get is not a function` whenever the
plugin settings carried no explicit `provider`/`model`. The default selection is
now read from the `agentDefaultModel` service (`currentSelection()`), with the
legacy reader and a `describe()` scan kept as guarded fallbacks — this is the
fallback layer of route resolution, so a missing reader must cost the layer, never
the request. (`src/orchestrate.ts`)

**Fixed — `/enhance` failed the same way.** It read `invocation.agent.session.id`;
the current contract is `interface Agent { readonly id: SessionId }`. Both shapes
are probed, and a host exposing neither simply drops the session route.
(`src/enhance-command.ts`)

**Fixed — no failure showed its actual cause.** Wire reasons are kebab-case
(`max-tokens`) while the dictionary keys are camelCase (`error.upstream.maxTokens`),
so `specific in zh` was always false and every specific fix hint fell back to the
generic provider line. Reasons are camel-cased before lookup, and the two codes
observed live but missing from the table (`MISSING_CREDENTIAL`, `SERVER`) plus
`TRANSPORT` were added to both dictionaries. (`src/enhancer.ts`, `src/client/ResultPanel.tsx`,
`src/client/locales.ts`)

**Changed — cost.** The rewrite now sends an explicit `reasoningEffort`, defaulting
to `off`. A rewrite is short and well-specified, and the model's own default effort
is expensive: measured on `deepseek-flash` for one ordinary draft — `off` 252 output
tokens, `low` 619, `high` (the route default) **2897**, `max` 4483. `inherit` omits
the field for routes that reject an explicit effort. `maxOutputTokens` default rises
2048 → 8192 (schema max 32768 → 65536): reasoning is billed against the same budget
and runs first, so the old cap could be consumed by reasoning alone and finish with
zero text — which is exactly what the user-visible "model returned an error" was.
(`src/config.ts`, `src/enhancer.ts`, `src/orchestrate.ts`)

**Added — the plugin's own Settings page.** The host has always served the Config
schema, but a DSH plugin gets no Settings UI for free: the Plugins page renders a
configure control only for a package whose client half registers `plugins.row.config`,
and a nav entry only for one registering `settings.section`. Neither existed, so the
configuration was unreachable from the GUI. A `settings.section` page now renders all
17 fields from one descriptor table, committing switches and selects immediately and
text/numbers on blur/Enter, validating ranges locally, and offering per-field reset
through `unset`. (`src/client/SettingsPanel.tsx`, `src/client/index.tsx`,
`src/client/styles.ts`)

**Changed — the schema must be volatile, on the harness schemastery build.**
`dsh-settings` projects a form only from a schema with `.volatile()` fields
(`volatileForm` returns undefined otherwise and `describe()` skips the entry), and
`.volatile()` exists only in `@deepseek-ai/schemastery` — the build every shipped
plugin imports — not in the public `schemastery` package. The dependency moved
accordingly, which also removed the `Volatile<T>` type skew the public package
caused. Because volatile fields arrive as live references, `resolveConfig` flattens
them before validating: a `Volatile<false>` is a truthy object, so validating first
would let a disabled section pass the `enabled` boolean check. (`src/config.ts`,
`package.json`, `pnpm-workspace.yaml`)

**Added — two operator tools, both plain node scripts.** `scripts/check-profile-mount.mjs`
(`npm run check:mount`) is a read-only preflight for a DSH profile: it parses the
profile patch and every declared bundle patch with the real `yaml` package, and fails
when two layers append the same row id to the root entry list (an id-less `insert` is
an unconditional append, so the Loader deduplicates nothing and startup aborts with
`duplicate loader entry id`); it also verifies every `link:` dependency resolves and
that `src/` is not newer than `lib/`. `scripts/probe-llm-call.mjs` drives the plugin's
exact `GenerateOptions` through the live `llm.stream()` and prints the raw failure —
the only way to see host-half failures, since the plugin's `console.info` never reaches
the desktop logs.

Tests: **196** (up from 163), adding composer rename coverage both directions,
volatile-reference flattening (including a referenced `false`), the settings form's
read/write/reset/validation contract, kebab→camel reason lookup for every reason,
the command's agent-id handling, and the first coverage of the SSE endpoint — two
tests that read the response to its end, which is what a missing `res.end()` fails.

**Baseline — devDependencies pinned to `0.1.7-rc.2`.** All nine DSH packages moved
at once (a partially bumped tree would prove nothing), and three more were added
because rc.2 ships `lib/types` for every package and the plugin's own contract only
checks out once the packages that DECLARE it are present:

- `dsh-client-ui-renderer` — owns the `Context.slots` augmentation. It is not
  `dsh-client-ui-slots`, which is where the type name suggests it lives.
- `dsh-client-ui-session` — declares `SessionStandardProps.sessionId`.
- `dsh-client-store` — defines `SnapshotSelectorHook`, which types `useInput`.
- `dsh-agent` — contributes the `'model-selection'` message source.

`src/client/host-contracts.d.ts` (new) declares this plugin's own conversation
message source: `MessageSourceMap` is merge-extensible by design (`dsh-agent`
extends it the same way), and rc.2 dropped the generic `'plugin'` kind the 0.1.x
types accepted, so the plugin now declares the source it has always stamped
instead of forcing a cast. No runtime change.

Two API changes the bump surfaced and this release adapts to:

- `InputState` is now the published type behind `useInput`; the compatibility face
  in `EnhanceButton` derives from it (`Omit<InputState, …>`) rather than standing
  alone, so a release that adds a required field cannot silently invalidate it.
- `@deepseek-ai/dsh-settings` REMOVED `installSettingsSection` and
  `settingsNamespace` in rc.2 (they are real exports of `0.1.1-rc.2` — verified
  against both published tarballs), so the legacy settings path now calls them
  through a structural view of the older surface. Deleting that path instead
  would have dropped rc.1 support, which is the version this fork is validated on.

`pnpm-workspace.yaml` is gone: CI uses npm (`npm ci`, `package-lock.json`), so a
second package manager's lockfile in the tree was pure confusion.

## 0.2.1 (2026-09-08)

Internal hardening from the 0.2.0 self-audit — three performance fixes with no behavior change, a privacy clarification in the docs, and a devDependency cleanup. No new features, no config changes.

**Performance.** `checkInputText` now walks the draft once by code point, counting characters and stripping invisible characters in the same pass — the old path allocated a full spread array per validation (`[...text]`, 12 k elements on a maximum-size draft) and then re-scanned with a regex. The rate-window expiry loop in the host route no longer `shift()`s expired stamps one at a time (O(N²) in the worst case at `rateLimitPerMinute = 600`); it finds the first surviving stamp and drains the expired prefix with a single `splice`. `appendDelta` on the browser side now coalesces same-turn deltas into one microtask flush, so a fast model pushing 100+ tokens/s triggers one React re-render per tick instead of one per token — synchronous reads of `getPanel().streaming` between the call and the flush intentionally return the previous value.

**Docs.** The `contextAware` row in both READMEs and the Security Model section now state plainly that with the switch on, the plugin ships up to `contextMaxMessages` turns / `contextMaxChars` characters of the current conversation to the configured LLM verbatim — users with secrets in the active session should turn it off or scope the session first.

**Dependencies.** `@deepseek-ai/dsh-agent` and `@deepseek-ai/dsh-client-runtime` are dropped from devDependencies: `src/` has had zero references to either since the 0.1.10 dual-compat rework (the `slots` / `sessionId` types they carried are satisfied at compile time through the remaining `dsh-client-ui-*` packages, and at runtime by the host itself). No change to `dependencies`, `peerDependencies`, or `engines.dsh`.

Tests: 163 (new regression: 50 same-turn deltas → one `notify`, not 50).

## 0.2.0 (2026-09-08)

Two additive features — context-aware rewrite and incremental output — plus the `stream-text` normalizer hardening those features depend on.

**Context-aware enhancement.** The host now grounds the rewrite in the current conversation: the latest `user`/`assistant` turns (capped by `contextMaxMessages` and `contextMaxChars`) are pulled through `Session.deriveMessages()` (or fall back silently), chosen newest-first inside the character budget, trimmed of `<conversation_context>` framing forgery, and assembled into a `<conversation_context>` block alongside the `<raw_prompt>` user message. Every failure mode (no session, no history, overflow, host throw) yields `undefined` and the call degrades to the original single-prompt enhancement — context is an optimization, never a prerequisite. Hard rules ride along only when context is supplied, so context-free calls keep byte-identical instructions; an explicit `(~250 字中文提示词]` clarifying clause on the model side forbids inventing anything the raw prompt does not support, forbids contradicting user intent, and forbids using the snippet to override the user's explicit constraints. New `Config.streaming` / `Config.contextAware` / `Config.contextMaxMessages` / `Config.contextMaxChars` (all defaulted + schemastery-described); `ClientSettings.streaming` mirrors the streaming default for the browser half.

**Incremental output.** The host route gains `/prompt-enhance/enhance-stream` (SSE, `text/event-stream` with `cache-control: no-cache, no-transform` and `x-accel-buffering: no` so proxies do not buffer it into one blob), shipping the same normalized final body as `done` frames plus per-chunk `delta` frames. The browser half auto-detects streamable responses (`Accept: text/event-stream` + non-empty body) and falls back to the one-shot JSON route when the host or network does not support it — the public API stays one `requestEnhance`. Display-side normalization (`src/shared/stream-text.ts`) withholds a leading fence opener until the newline arrives and absorbs the trailing line break that belongs to a withheld closing fence, so the panel never flashes a blank line ahead of an unwritten closer.

**Other changes.** `EnhanceButton` honors `settings.streaming` (default on) when calling the host; `ui-state` adds a `streamingText` partial body, `appendDelta`, and `settleStreamedResult` for the streamed path. The test base grows to **162** (12 context-window selection, 9 incremental-text normalization, 6 client streaming, plus expanded config / client-settings / component coverage and tightened assertions on the `/enhance` route through `sessionRouteOf`).

## 0.1.11 (2026-09-08)

Fix a defect in the 0.1.10 dual-compat fallback that made the undo bar unreachable on `0.1.2-rc.1`. The two client entries — `EnhanceButton` (`conversation.input.right`) and `UndoBar` (`conversation.input.dock`) — are separate component trees, but the fallback id was minted per component instance, so without a host `sessionId` the button pushed its undo entry under one key (`pe:1`) while the bar peeked another (`pe:2`): apply succeeded, yet the undo affordance never appeared.

`useSessionKey(sessionId, inputActions)` now anchors the fallback on the host's `inputActions` — the same object is handed to every slot of one input zone and is documented as stable per Session — so both halves of one composer resolve the same key via a `WeakMap`. When the host id is present the host id is still used verbatim (unchanged `0.1.1-rc.2` behaviour, and it now follows the prop live rather than freezing at mount). `useCallback` deps in `EnhanceButton` follow the rename (`uiKey`, plus `wireId` for the id actually sent).

Tests: 134 (new rc.1 component regression: `sessionId` absent → route receives `undefined`, apply → undo bar appears → undo restores the original — the exact loop that was silently broken).

## 0.1.10 (2026-09-08)

Dual-host compatibility across the dsh `0.1.1-rc.2` and `0.1.2-rc.1` client API split, with no `package.json` / `engines` change (`engines.dsh` already covers both).

- **Client session key** (new `src/client/session-key.ts`): the input slot owner share (`SessionStandardProps`) carried a `sessionId` on `0.1.1-rc.2`, which `0.1.2-rc.1` dropped (the snapshot hooks `useConversation` / `useInput` / `inputActions` remain). `EnhanceButton` / `UndoBar` now key their panel, undo stack, and shortcut target by `useSessionKey(sessionId)` — the host id when present, otherwise a stable per-mount fallback — so the UI stays correct on both lines. The host route receives the real id only via `serverSessionId(sessionId)`; on `0.1.2-rc.1` it is `undefined`, which degrades to the harness default model route (`sessionRouteOf` undefined branch) — the documented fallback.
- **Settings registration**: the existing `installSettingsSectionCompat` already probes `ctx.settings.installSection(owner, ns, schema, entry, hooks)` (the `0.1.2` service method) versus the legacy standalone `installSettingsSection` / `settingsNamespace` helpers (the `0.1.1-rc` line, reached through a dynamic import); both paths are exercised by the existing tests. `dsh-client-runtime` stays a devDependency for its cordis declaration merging (`slots` / `sessionId` types), which the `0.1.2` host still satisfies at runtime via `dsh-cordis-client-runner`.

No user-visible behavior change on `0.1.1-rc.2`; the `0.1.2-rc.1` line gains a working client (per-session model routing is unavailable there because the host no longer exposes the session id to the input slots).

## 0.1.9 (2026-09-01)

Fix a silent no-op in the per-session route-priority layer: `Session.requestHeader` is a method on both dsh generations (`requestHeader(): EpochHeader | undefined`), not a property, but `sessionRouteOf()` read it as a field — so the lookup always saw `undefined` and fell through to the default route. The test mocks shaped it as a property, which is exactly why they passed while the real runtime path was dead. The read now probes at runtime (call it when it is a function, otherwise use the value), and `SessionsFace` reflects both shapes. The client half also dropped its leftover type-only empty imports of the removed `dsh-client-runtime` / `dsh-client-ui-conversation` client entry points, and `ClientContext` now resolves from `@deepseek-ai/cordis` directly (the `dsh-client-runtime` devDependency stays for its cordis declaration merging).

Tests: 132 (method-shaped mock, method returning `undefined`, defensive property-shaped value, and a new 7-case `/enhance` command suite — empty arg, disabled, over-length, success, error mapping, missing `commands` service skip, `recordInput`).

## 0.1.8 (2026-09-01)

Compatibility fix found by testing the plugin on a real 0.1.2-alpha.3 harness, not by inspection: `@deepseek-ai/dsh-settings` moved its registration API — the alpha line dropped the standalone `installSettingsSection()` / `settingsNamespace()` exports and exposes the same wiring as `ctx.settings.installSection(owner, ns, …)`. Because the host half imported those names statically, the plugin failed at module load with `SyntaxError: … does not provide an export named 'installSettingsSection'`, taking the whole web profile down; 0.1.7 fixed the inject list but still crashed there.

Registration now goes through `ctx.inject(['settings'])` — the service-availability gate both generations use internally — with a runtime probe picking the API the mounted service speaks, and the legacy helpers reached through a dynamic import so an alpha build never evaluates the removed names. Verified on a real alpha.3 profile: the layer mounts, the route answers, the client bundle builds with all four injected packages resolved, and the settings service (`dsh-settings-file`) is present so the alpha branch is the one taken.

Tests: 122 (alpha `installSection` branch, legacy standalone-helper fallback, no-service case, and a load-time guard that fails if a static import of the removed names ever comes back).

## 0.1.7 (2026-09-01)

Compatibility fix for the 0.1.2-alpha harness cohort, reported in the upstream market review (zhu1090093659/dsh-web#1282): `@deepseek-ai/dsh-client-runtime` was removed upstream (it never published an alpha), so its entry in `dsh.client.inject` failed to resolve on alpha hosts and the plugin would not load. The entry is gone from the inject list — the browser half only ever used the package as a type-only import (`import type`), and the compiled `lib/client.js` has zero runtime references to it, so nothing changes at runtime. The remaining 4 injected packages all publish alphas and stay. `engines.dsh` tightens from `>=0.1.1-rc.1` to `>=0.1.1-rc.2`, the version actually tested (rc.1 predates the runtime package). The devDependency is kept for compile-time type checking only.

## 0.1.6 (2026-08-31)

Errors are now structured: the host sends `{ code, params?, message? }` where `message` is only an optional diagnostic detail (provider raw text, config errors) — the browser renders its localized primary line from `code`/`params` via the locale dictionaries, so non-Chinese UIs no longer see Chinese host copy. `upstream` errors carry an optional `reason` (auth / quota / rateLimit / empty / contextWindow / toolCall / maxTokens / invalidCredential) that picks a specific fix hint; over-length rejections carry `{ count, max }` and reuse the too-long input message. A host-side `formatEnhanceError()` renders the same errors for the `/enhance` command plane, which has no browser dictionary.

Rate limiting counts successful calls only: a stamp lands after the 200 is written, so a run of failures (timeouts, upstream errors, cancellations) no longer burns the user's per-minute window and locks them out right when the model recovers. The concurrency cap still bounds in-flight calls regardless of outcome. `Retry-After` and the `rate-limit` params stay in sync.

Undo stack: the per-session store now has a global entry cap (default 60) with least-recently-written-session eviction, so many long-lived sessions cannot accumulate undo entries without bound (per-session depth 3 unchanged).

Docs: error-code reference table, troubleshooting section, and the success-only rate-window semantics in the zh README; the browser half's single-panel concurrency (1 in-flight request) vs the host `maxConcurrent` cap is documented rather than changed.

Tests: 118 (failed calls do not consume the rate window, structured error params, host-side error rendering, undo-stack global-cap eviction).

## 0.1.5 (2026-08-31)

Features: a `strategyMode` setting (`replace-default` | `extend-default`, default `replace-default` for backward compatibility) — a non-empty custom `systemPrompt` either swaps the built-in strategy out entirely (`replace-default`, the earlier behavior) or is appended after it (`extend-default`), so the built-in hard rules stay in force. Host call logs no longer record the provider/model route, which can carry internal gateway or project identifiers — request id and sizes only.

Security/resource: `Content-Length` fast reject answers `413` before a single body byte is read (the streamed cap stays as the chunked-body backstop), and the connection closes after the refusal so a declared-but-never-sent body cannot pin the socket open. Re-applying the plugin on one context no longer stacks a second admission gate, which would have silently doubled the effective limits. The rate cap and the concurrency cap now answer distinct codes (`rate-limit` / `concurrency-limit`) — the rate branch sends a precise `Retry-After` computed from the sliding window; the concurrency branch sends none, because a busy slot frees whenever an in-flight call settles.

Consistency: input lengths are counted by one shared `countText()` (Unicode code points) everywhere — validation, error copy, and host logs no longer disagree on emoji or composed characters; copy now says 字符/characters and states it is a character count, not a token count.

Docs: single-process scope of the admission caps, undo-stack lifecycle (page memory, 3 per session), the `strategyMode` combination semantics for `systemPrompt`, request-level timeout ownership (host/Node, not the plugin), and a corrected 0.1.2 note on oversized bodies.

Tests: 112 (Content-Length fast reject, no-Origin local caller, concurrency slot returned after a mid-flight disconnect, one gate per context, degenerate and attacker-shaped Origins, localhost look-alike Hosts, code-point counting, strategy modes).

## 0.1.4 (2026-08-29)

Security/resource: `Origin` gate on the enhance route (cross-site fire-and-forget POSTs are refused), host-side concurrency cap (`maxConcurrent`, default 2) and sliding-window rate limit (`rateLimitPerMinute`, default 10) answering `429`, structured single-line call logs (request id, route, input/output sizes, error code — never the prompt text), `X-Forwarded-For` / `Forwarded` requests refused.

Robustness: `resolveConfig` deep runtime validation (types, finiteness, ranges, integrality) with provider/model stored trimmed; strict client envelope parsing (provider/model/elapsedMs validated, unknown error codes normalized); input length counted in Unicode code points; single-line and CRLF fence normalization.

Docs: security and language-consistency statements softened to best-effort wording, compatibility matrix, install smoke checklist, `/enhance` cancellation note, evidence-binding rule in the default strategy.

Tests: 97 (admission gate 429s, Origin gate, deep config validation, route-resolution trimming, single-line/CRLF fences, code-point counts).

## 0.1.2 (2026-08-29)

Security: `Host` header allowlist on the enhance route (defeats DNS rebinding), `cache-control: no-store`, `<raw_prompt>` framing neutralizes literal closing tags, Security Model docs section (en/zh).

Usability: light theme via theme-scoped variables + `prefers-color-scheme`, server errors localized by stable code with the host message as detail line, shortcut parsing requires at least one modifier, dialog accessibility (`aria-modal`, focus trap, IME-safe Escape).

Fixes: applying over a draft edited during the request keeps the current draft restorable via undo (plus a stale-content warning both ways), busy-click no longer orphans the running request, disconnect abort uses a version-safe `res.close` + `writableEnded` guard, timed-out streams finalize their iterators, oversized streamed bodies answer `413` without destroying the connection (the route still owes the client a deliverable response), route validates its exact path, disabled state short-circuits before body read, unknown legacy config keys stripped, multi-session shortcut fallback.

Tests: 78 (component suite with jsdom/RTL, real-socket disconnect regression, loopback/Host fence units, prompt-framing units). Shared orchestration extracted (`orchestrate.ts`).

## 0.1.1 (2026-08-29)

Docs: bilingual README (English + 简体中文) with architecture walkthrough, configuration table, error matrix, development guide, FAQ; evidence screenshot; package metadata (keywords, repository, homepage).

## 0.1.0 (2026-08-29)

Initial release: composer enhance button (`conversation.input.right`), before/after preview panel, one-click undo bar (`conversation.input.dock`), `/enhance` slash command, configurable global shortcut, settings section rendered in Settings → 插件配置, host route via `ctx.llm` with model routing (settings pair → session model → harness default), 56 tests.
