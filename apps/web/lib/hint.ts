"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "veto:tried";
const EVENT = "veto:tried";

/**
 * Whether to show the "start here" hint: only until the visitor first opens the agent inbox
 * or lets the agent pay. Remembered per browser; every hint on the page hides together.
 */
export function useStartHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(false);
    }
    const hide = () => setShow(false);
    window.addEventListener(EVENT, hide);
    return () => window.removeEventListener(EVENT, hide);
  }, []);

  const done = useCallback(() => markTried(), []);
  return { show, done };
}

export function markTried() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Storage can be unavailable; the hint just hides for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}
