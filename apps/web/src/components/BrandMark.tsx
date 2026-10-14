import { appBrand } from '../lib/brand.ts';

/** The staff app's mark: Vivistays for now. Uses the logo file once one is set in app-brand.json. */
export function BrandMark() {
  if (appBrand.logo.light) {
    return <img src={appBrand.logo.light} alt={appBrand.name} className="h-5 w-auto" />;
  }
  return (
    <span className="text-[14px] font-semibold tracking-[0.14em] text-ink">
      <span aria-hidden>{appBrand.wordmark}</span>
      <span className="sr-only">{appBrand.name}</span>
    </span>
  );
}
