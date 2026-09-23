import { stateFile } from '@franzenzenhofer/intent-core/paths';

/**
 * The files cdai keeps, by name. The shared core knows where state lives; what lives there is
 * every product's own business, which is why these four names are here and not in it.
 */
export const dbFile = (): string => stateFile('db.json');
export const indexFile = (): string => stateFile('index.json');
export const aliasesFile = (): string => stateFile('aliases.json');
/** Appended to by the shell hook, drained by cdai. See store/visit-claims.ts. */
export const visitsLog = (): string => stateFile('visits.log');
