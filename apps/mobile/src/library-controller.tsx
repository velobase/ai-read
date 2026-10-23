import { createContext, useContext } from 'react';
import type { LibraryHandle } from './adapters/library-scope';

export type LibraryController = {
  switching: boolean;
  blocked: boolean;
  switchTo: (handle: LibraryHandle) => Promise<void>;
  registerFlush: (flush: () => Promise<void>) => () => void;
};
export const LibraryControllerContext = createContext<LibraryController | null>(null);
export function useLibraryController(): LibraryController {
  const controller = useContext(LibraryControllerContext);
  if (!controller) throw new Error('missing_library_controller');
  return controller;
}
