import { setProduct } from '@franzenzenhofer/intent-core/product';

/**
 * The product identity the shared core asks for, set once per test process exactly as
 * src/cli.ts sets it in production. The core refuses to guess it, which is the whole point:
 * a core that guessed would read and write another tool's state directory.
 */
setProduct({ name: 'cdai', envPrefix: 'CDAI' });
