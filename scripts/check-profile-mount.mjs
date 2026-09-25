/**
 * Pre-startup mount check for a DSH Desktop profile.
 *
 * Why this exists: on 2026-09-25 a linked plugin was mounted twice — once from
 * the profile's own `cordis.patch.yml` and once through the package's bundled
 * patch — and the desktop app died during startup with
 *
 *   duplicate loader entry id "prompt-enhance" in the composed profile
 *
 * `assertUniqueEntryIds` runs inside `prepareDesktopProfile`, which reconciles
 * the profile on disk, so it is not callable as a read-only preflight. This
 * script reproduces the invariant instead, using the Loader's real patch
 * semantics (`@deepseek-ai/cordis-plugin-include` → `applyEntryPatches`):
 *
 *   - a patch with `insert` and NO `id` appends its rows to the ROOT entry list
 *     unconditionally (`data.push(...insert)`) — there is no dedup, so two
 *     layers appending the same row id produce a duplicate;
 *   - a patch with `insert` AND an `id` pushes into an existing group instead.
 *
 * Only the first, unambiguous case is reported as a failure. Rows added inside
 * groups can legitimately collide with base-layer rows and are handled by the
 * Loader, so this script deliberately stays silent about them rather than
 * guessing. It also verifies that every `link:` dependency resolves and is
 * actually mounted into the profile's node_modules.
 *
 * Read-only: nothing is written to the profile.
 *
 * Usage:
 *   node scripts/check-profile-mount.mjs [profileDir]
 *
 * `profileDir` defaults to $DSH_PROFILE_DIR, then ~/.dsh/profiles/desktop.
 * Exit code 0 = safe to start, 1 = problems listed.
 * @module dsh-prompt-enhance/scripts/check-profile-mount
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, isAbsolute, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const profileDir = resolve(
  process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'desktop'),
)

const require = createRequire(join(profileDir, 'package.json'))

/**
 * The Loader's own YAML parser. Resolved from the profile so the check uses the
 * same package graph the runtime does, and reports clearly when it is absent
 * instead of silently degrading to a hand-rolled parser (which is exactly how
 * an earlier version of this script produced false duplicates).
 */
let YAML
try {
  YAML = require('yaml')
} catch {
  console.error('preflight: the "yaml" package is not resolvable from the profile; cannot verify')
  process.exit(1)
}

const problems = []
const notes = []

/**
 * Parse YAML while suppressing the parser's `YAMLWarning` notices.
 *
 * Patch layers carry the Loader's `!!js` tag for deferred expressions, which a
 * plain parse reports as an unresolved tag. Those values are opaque here — a
 * row id or `insert` list is never `!!js` — and the notices are routed through
 * `process.emitWarning`, not the package's own hook, so they are filtered by
 * warning name rather than muted globally. Every other warning still surfaces.
 * @param text - raw YAML.
 * @returns the parsed document.
 */
function parseYaml(text) {
  const previous = process.emitWarning
  process.emitWarning = (warning, ...rest) => {
    const name = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type
    const isYamlNotice = name === 'YAMLWarning' || String(warning).includes('YAMLWarning')
    if (isYamlNotice) return
    previous.call(process, warning, ...rest)
  }
  try {
    return YAML.parse(text)
  } finally {
    process.emitWarning = previous
  }
}

/** Parse a patch layer into its list of patch objects; [] for a missing file. */
function readPatchLayer(layerName, patchPath) {
  if (!existsSync(patchPath)) return []
  let parsed
  try {
    parsed = parseYaml(readFileSync(patchPath, 'utf8'))
  } catch (error) {
    problems.push(`${layerName}: patch file is not valid YAML (${error.message})`)
    return []
  }
  if (parsed === null || parsed === undefined) return []
  if (!Array.isArray(parsed)) {
    problems.push(`${layerName}: patch file must parse to a top-level array`)
    return []
  }
  return parsed
}

/** Row ids a package contributes, following its declared bundle patch. */
function patchLayerOf(pkgName) {
  let manifestPath
  try {
    manifestPath = require.resolve(`${pkgName}/package.json`)
  } catch {
    problems.push(`bundle "${pkgName}" does not resolve from ${profileDir}`)
    return []
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const patchPath = manifest.dsh?.bundle?.patch
  if (typeof patchPath !== 'string') return []
  const absolute = isAbsolute(patchPath) ? patchPath : resolve(manifestPath, '..', patchPath)
  return readPatchLayer(`bundle ${pkgName}`, absolute)
}

/**
 * Row ids appended to the ROOT entry list by id-less inserts, tagged with the
 * layer that appended them. This is the one path where the Loader performs no
 * dedup, so a shared id here is guaranteed to reach `assertUniqueEntryIds`.
 * @param patches - parsed patch layer.
 * @returns `{ id, layer }` for every root-appended row.
 */
function rootAppends(patches) {
  const rows = []
  for (const patch of patches) {
    if (patch === null || typeof patch !== 'object') continue
    if (!Array.isArray(patch.insert)) continue
    if (patch.id !== undefined) continue
    for (const row of patch.insert) {
      if (row !== null && typeof row === 'object' && typeof row.id === 'string') {
        rows.push({ id: row.id, layer: patch.__layer })
      }
    }
  }
  return rows
}

const profileManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const bundles = profileManifest.dsh?.profile?.bundles ?? []
const dependencies = profileManifest.dependencies ?? {}

// A `link:` target that vanished, or a dependency that was declared but never
// mounted, surfaces at startup as an unresolvable module with no hint about
// which link went bad.
for (const [name, spec] of Object.entries(dependencies)) {
  if (typeof spec !== 'string' || !spec.startsWith('link:')) continue
  const target = spec.slice('link:'.length)
  if (!existsSync(target)) {
    problems.push(`dependency "${name}" links to a missing path: ${target}`)
    continue
  }
  const installed = join(profileDir, 'node_modules', name)
  if (!existsSync(installed)) {
    problems.push(`dependency "${name}" is declared but not mounted in node_modules`)
    continue
  }
  notes.push(`linked: ${name} -> ${target}`)
}

const layers = [
  { name: 'profile cordis.patch.yml', patches: readPatchLayer('profile cordis.patch.yml', join(profileDir, 'cordis.patch.yml')) },
  ...bundles.map((bundle) => ({ name: `bundle ${bundle}`, patches: patchLayerOf(bundle) })),
]

/** Row id -> layers that root-append it. */
const appenders = new Map()
for (const layer of layers) {
  for (const patch of layer.patches) patch.__layer = layer.name
  for (const { id, layer: owner } of rootAppends(layer.patches)) {
    const previous = appenders.get(id)
    if (previous === undefined) appenders.set(id, [owner])
    else previous.push(owner)
  }
}

for (const [id, owners] of appenders) {
  if (owners.length > 1) {
    problems.push(`row id "${id}" is root-inserted more than once: ${owners.join(' + ')}`)
  }
}

// The two halves of a dual-face plugin load through different mechanisms, so
// report which file each resolves to — useful when a plugin is linked from a
// working copy rather than installed from the registry.
for (const bundle of bundles) {
  let manifestPath
  try {
    manifestPath = require.resolve(`${bundle}/package.json`)
  } catch {
    continue // already reported as unresolvable above
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    continue
  }
  if (manifest.dsh?.client === undefined) continue
  const clientEntry = manifest.exports?.['./client']
  const clientPath = typeof clientEntry === 'string'
    ? clientEntry
    : clientEntry?.default ?? clientEntry?.types
  notes.push(
    `client half: ${bundle} -> ${typeof clientPath === 'string' ? resolve(manifestPath, '..', clientPath) : '(no ./client export)'}`,
  )
}

// Stale-build check, scoped to THIS plugin's working copy. Third-party packages
// ship `src/` alongside `lib/` without being rebuilt locally, so testing their
// mtimes reports staleness that does not exist — only the checkout this script
// lives in is ours to rebuild. The host imports the server half once at startup
// and keeps running that module, so a source edit without a rebuild is
// otherwise invisible until something behaves like the old code.
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const [sourceName, builtName] of [['src/index.ts', 'lib/index.js'], ['src/client/index.tsx', 'lib/client.js']]) {
  const sourcePath = join(pluginRoot, sourceName)
  const builtPath = join(pluginRoot, builtName)
  if (!existsSync(sourcePath) || !existsSync(builtPath)) continue
  if (statSync(sourcePath).mtimeMs > statSync(builtPath).mtimeMs) {
    problems.push(`${sourceName} is newer than ${builtName} — run "npm run build" before restarting`)
  }
}

for (const note of notes) console.log(`  ${note}`)
console.log(`profile: ${profileDir}`)
console.log(`layers checked: ${layers.length} (1 profile patch + ${bundles.length} bundles)`)
console.log(`root-appended row ids: ${appenders.size}`)

if (problems.length > 0) {
  console.error('\nPREFLIGHT FAILED — startup would abort with a duplicate/loader error:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('preflight OK: no duplicate root-inserted row ids, every link resolves')
