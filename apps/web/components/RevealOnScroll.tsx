"use client";

import { useEffect } from "react";

/**
 * Sections marked `data-reveal` rise in as they scroll into view. Browsers with scroll-driven
 * animations do it in CSS; others get this IntersectionObserver fallback. Content is only
 * hidden once this has run, so nothing disappears if scripts don't load.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.dataset.revealMode = "io";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.in = "";
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return null;
}
