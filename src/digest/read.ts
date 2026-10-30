import type { ReadNight } from './types.js';

// Implemented in #2. Here so § 2 can import and typecheck against it before the reader lands.
export const readNight: ReadNight = () => {
  throw new Error('readNight: not implemented yet (#2)');
};
