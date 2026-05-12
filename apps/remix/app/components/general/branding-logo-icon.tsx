import type { ImgHTMLAttributes } from 'react';

export type LogoProps = ImgHTMLAttributes<HTMLImageElement>;

/**
 * Square D2DHQ mark — same asset as BrandingLogo, kept as a separate
 * component so existing icon-only call sites don't need to be edited.
 */
export const BrandingLogoIcon = ({ alt = 'D2DHQ', ...props }: LogoProps) => {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/d2dhq-mark.svg" alt={alt} {...props} />;
};
