import type { ImgHTMLAttributes } from 'react';

export type LogoProps = ImgHTMLAttributes<HTMLImageElement>;

/**
 * D2DHQ brand mark. The component name + import sites stay as
 * `BrandingLogo` so we don't have to sweep every header / footer / embed.
 * Rendered as an <img> rather than inline <svg> so we can keep the
 * vector-traced D2DHQ red on every background without fighting
 * `currentColor` inheritance.
 */
export const BrandingLogo = ({ alt = 'D2DHQ', ...props }: LogoProps) => {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/d2dhq-mark.svg" alt={alt} {...props} />;
};
