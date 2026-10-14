import { appBrand } from '../lib/brand.ts';

/** The app's mark on the sign-in page: Vivistays for now. Uses the logo file once one is set in app-brand.json. */
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

/** The operator whose workspace this is: their logo once uploaded, otherwise their name as a wordmark. */
export function OperatorMark({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  if (logoUrl) return <img src={logoUrl} alt={name} className="h-5 w-auto" />;
  return (
    <span
      className="block truncate text-[14px] font-semibold tracking-[0.14em] text-ink uppercase"
      title={name}
    >
      {name}
    </span>
  );
}

/** V-01's own console. V-01 is the working name until the company has its own. */
export function ConsoleMark() {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[15px] font-semibold tracking-[0.1em] text-canvas">V-01</span>
      <span className="text-[12.5px] text-console-muted">Console</span>
    </span>
  );
}
