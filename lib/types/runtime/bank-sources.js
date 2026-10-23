/**
 * Build the controller's BankSources. Never throws: malformed external packs
 * that cannot be keyed by id are ignored (the loader already validated shape).
 */
export function assembleBankSources(input) {
    const packs = [...input.builtinPacks];
    const externalPacks = input.external?.packs;
    if (Array.isArray(externalPacks)) {
        for (const candidate of externalPacks) {
            if (candidate === null || typeof candidate !== 'object' || typeof candidate.id !== 'string')
                continue;
            const index = packs.findIndex(pack => pack.id === candidate.id);
            if (index >= 0)
                packs[index] = candidate;
            else
                packs.push(candidate);
        }
    }
    const enabledPacks = (() => {
        const externalChoice = input.external?.enabledPacks;
        if (externalChoice !== undefined)
            return externalChoice;
        const configured = input.config.enabledPacks;
        if (configured === undefined)
            return input.defaultEnabledPacks;
        if (configured === null)
            return null;
        return configured;
    })();
    return {
        ...(input.external?.phrases === undefined ? {} : { core: input.external.phrases }),
        packs,
        enabledPacks,
    };
}
