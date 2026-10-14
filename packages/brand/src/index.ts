import { z } from 'zod';
import appBrandJson from '../app-brand.json' with { type: 'json' };

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected a colour like #1E4D4F');

export const AppBrandSchema = z.object({
  name: z.string().min(1),
  wordmark: z.string().min(1),
  logo: z.object({ light: z.string().nullable(), dark: z.string().nullable() }),
  tokens: z.object({
    /** Page background (soft white). */
    canvas: Hex,
    /** Sidebar, cards and panels: one step darker than the page. */
    paper: Hex,
    /** Hover, selected rows and chips. */
    linen: Hex,
    hairline: Hex,
    ink: Hex,
    slate: Hex,
    mist: Hex,
    edge: Hex,
    accent: Hex,
    accentTint: Hex,
    plum: Hex,
    urgent: Hex,
    pending: Hex,
    pendingText: Hex,
    done: Hex,
    doneText: Hex,
  }),
});
export type AppBrand = z.infer<typeof AppBrandSchema>;
export type BrandTokens = AppBrand['tokens'];

/** The staff app's look. Vivistays for now; see app-brand.json. */
export const appBrand: AppBrand = AppBrandSchema.parse(appBrandJson);

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * An operator's accent, darkened step by step until text in it reaches the minimum
 * contrast on the background (design roadmap, page 07: 4.5:1 on Paper).
 */
export function ensureContrast(accent: string, background: string, minimum = 4.5): string {
  let rgb = parseHex(accent);
  for (let i = 0; i < 100 && contrastRatio(toHex(rgb), background) < minimum; i++) {
    rgb = rgb.map((v) => v * 0.95) as [number, number, number];
  }
  return toHex(rgb);
}

/** CSS custom properties for a brand, e.g. { '--brand-accent': '#1E4D4F' }. */
export function brandCssVariables(tokens: BrandTokens): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [
      `--brand-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
      value,
    ]),
  );
}
