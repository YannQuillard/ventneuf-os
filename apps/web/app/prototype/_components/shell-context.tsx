"use client";

import { createContext, useContext } from "react";

export interface ShellContextValue {
  isMobile: boolean;
  isCompact: boolean;
  openNavigation: () => void;
  openSearch: () => void;
  navigate: (href: string) => void;
}

export const ShellContext = createContext<ShellContextValue>({
  isMobile: false,
  isCompact: false,
  openNavigation: () => undefined,
  openSearch: () => undefined,
  navigate: () => undefined,
});

export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}
