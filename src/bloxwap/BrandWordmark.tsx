import type { CSSProperties } from 'react';
import { BRAND_GREEN, BRAND_WORDMARK, BRAND_X } from './brand';

/**
 * The drawn wordmark (letters + X), sized by the letters' cap height so it lines up with text
 * of that cap height. The box is trimmed at the "p" descender (the source box pads ~36 units
 * below it), so the SVG's bottom edge is the ink's bottom edge.
 * `letters` colors the letters; `x` the X (brand green by default). Pass one color to both for
 * a monochrome mark.
 */
export function BrandWordmark({
  capHeight,
  letters = 'currentColor',
  x = BRAND_GREEN,
  className,
  style,
  label,
}: {
  capHeight: number;
  letters?: string;
  x?: string;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; omit for a decorative mark. */
  label?: string;
}) {
  const scale = capHeight / BRAND_WORDMARK.capHeight;
  const boxHeight = BRAND_WORDMARK.baseline + BRAND_WORDMARK.descender;
  return (
    <svg
      width={BRAND_WORDMARK.width * scale}
      height={boxHeight * scale}
      viewBox={`0 ${-BRAND_WORDMARK.baseline} ${BRAND_WORDMARK.width} ${boxHeight}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={BRAND_WORDMARK.letters} fill={letters} />
      <g transform={BRAND_WORDMARK.xTransform}>
        <g fill="none" stroke={x} strokeWidth={BRAND_X.strokeWidth} strokeLinecap="round">
          {BRAND_X.paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}
