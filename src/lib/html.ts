// Tiny helpers for the demos' HTML strings. The same render functions run at
// build time (no-JS fallback, via set:html) and in the browser after a demo
// loads, so the two can never drift apart.

export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const svg = (d: string) =>
  `<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Outcome icons: never rely on colour alone. */
export const ICON = {
  allow: svg('M3 8.5l3.2 3.2L13 4.8'),
  deny: svg('M4 4l8 8M12 4l-8 8'),
  approval: svg('M5 3h6M5 13h6M5.5 3c0 3 5 3 5 5s-5 2-5 5M10.5 3c0 3-5 3-5 5s5 2 5 5'),
  neutral: '',
} as const;
