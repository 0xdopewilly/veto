"use client";

import { useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 900px)";

/** Matches a media query on the client; false while rendering on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);
