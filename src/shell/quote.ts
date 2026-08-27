/** Single quotes a value for POSIX shells, so paths with spaces survive an eval. */
export const shellQuote = (value: string): string => `'${value.split(`'`).join(`'\\''`)}'`;

/** fish only needs the quote itself escaped inside single quotes. */
export const fishQuote = (value: string): string => `'${value.split(`'`).join(`\\'`)}'`;
