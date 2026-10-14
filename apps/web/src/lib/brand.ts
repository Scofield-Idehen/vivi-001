import { appBrand, brandCssVariables } from '@v01/brand';

/** Applies the staff app's look (Vivistays for now) from packages/brand/app-brand.json. */
export function applyAppBrand(): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(brandCssVariables(appBrand.tokens))) {
    root.style.setProperty(name, value);
  }
  document.title = appBrand.name;
}

export { appBrand };
