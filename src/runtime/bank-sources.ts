/**
 * Assemble the bank sources the rotation controller consumes from the
 * built-in packs, the optional external bank override and the resolved config.
 *
 * Layering (highest priority last):
 *   built-in packs -> external bank packs by id -> config enabled-pack choice.
 * An external pack with the same id replaces the built-in pack wholesale (the
 * documented, predictable rule); a new id appends. External core phrases are
 * the only core layer because the built-in core is empty.
 *
 * @module dsh-tui-status-rotator/runtime/bank-sources
 */
import type { BankDoc, PackDoc, ResolvedConfig } from '../types.js'
import type { BankSources } from './controller.js'

/** Inputs for one assembly pass. */
export interface AssembleBankSourcesInput {
  readonly builtinPacks: readonly PackDoc[]
  readonly defaultEnabledPacks: readonly string[]
  readonly external: BankDoc | null
  readonly config: ResolvedConfig
}

/**
 * Build the controller's BankSources. Never throws: malformed external packs
 * that cannot be keyed by id are ignored (the loader already validated shape).
 */
export function assembleBankSources(input: AssembleBankSourcesInput): BankSources {
  const packs: PackDoc[] = [...input.builtinPacks]
  const externalPacks = input.external?.packs
  if (Array.isArray(externalPacks)) {
    for (const candidate of externalPacks) {
      if (candidate === null || typeof candidate !== 'object' || typeof candidate.id !== 'string') continue
      const index = packs.findIndex(pack => pack.id === candidate.id)
      if (index >= 0) packs[index] = candidate
      else packs.push(candidate)
    }
  }
  const enabledPacks = (() => {
    const externalChoice = input.external?.enabledPacks
    if (externalChoice !== undefined) return externalChoice
    const configured = input.config.enabledPacks
    if (configured === undefined) return input.defaultEnabledPacks
    if (configured === null) return null
    return configured
  })()
  return {
    ...(input.external?.phrases === undefined ? {} : { core: input.external.phrases }),
    packs,
    enabledPacks,
  }
}
