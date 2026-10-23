import { createContext, useContext } from 'react';
import type { LibraryLease } from './adapters/library-scope';

/** Each mounted library tree receives one immutable lifetime, never a global active database. */
export const LibraryContext = createContext<LibraryLease | null>(null);

export function useLibrary(): LibraryLease {
  const library = useContext(LibraryContext);
  if (!library) throw new Error('missing_library_context');
  return library;
}
