/**
 * Series colors for the comparison chart.
 *
 * The eight hues come from the data-viz validated categorical palette (its
 * *adjacent* pairlist clears the CVD and normal-vision gates for line charts).
 * The actual hex values (light + dark steps) live as `--series-1..8` custom
 * properties in StatsPage.css; here we only name the slots. Slot 1's blue is
 * close to the app brand on purpose.
 *
 * Identity is never carried by color alone — every series has a color-matched
 * name chip in the legend — which is what lets us use the three lower-contrast
 * hues (the palette validator's relief rule).
 */
export const SERIES_SLOTS = 8

/** The CSS color for a palette slot (0-based), as a themed custom property. */
export function seriesColor(slot: number): string {
  return `var(--series-${(slot % SERIES_SLOTS) + 1})`
}

/** The global-average line: a neutral, deliberately not a categorical hue. */
export const GLOBAL_COLOR = 'color-mix(in srgb, CanvasText 45%, Canvas)'
