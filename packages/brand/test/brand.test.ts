import { describe, expect, it } from 'vitest';
import { appBrand, brandCssVariables, contrastRatio, ensureContrast } from '../src/index.ts';

describe('app brand', () => {
  it('is Vivistays for now', () => {
    expect(appBrand.name).toBe('Vivistays');
  });

  it('keeps every text colour readable on Paper (WCAG AA)', () => {
    const { paper, ink, slate, mist, accent, urgent, pendingText, doneText } = appBrand.tokens;
    for (const text of [ink, slate, mist, accent, urgent, pendingText, doneText]) {
      expect(contrastRatio(text, paper)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('turns tokens into CSS variables', () => {
    const vars = brandCssVariables(appBrand.tokens);
    expect(vars['--brand-accent']).toBe('#1E4D4F');
    expect(vars['--brand-pending-text']).toBe('#856020');
  });
});

describe('operator accents', () => {
  it('darkens a pale accent until it passes 4.5:1', () => {
    const pale = '#7FB3D5';
    expect(contrastRatio(pale, '#F5F2EC')).toBeLessThan(4.5);
    const fixed = ensureContrast(pale, '#F5F2EC');
    expect(contrastRatio(fixed, '#F5F2EC')).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves an accent that already passes alone', () => {
    expect(ensureContrast('#1E4D4F', '#F5F2EC')).toBe('#1E4D4F');
  });
});
