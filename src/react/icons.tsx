// Inline SVG icons. Stroke-based so the check can be DRAWN with
// stroke-dashoffset; `pathLength="1"` makes the dash math size-independent.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...rest,
  };
}

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path className="facta-draw" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" />
  </svg>
);

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 8v5m0 3.5v.01" />
    <path d="M10.3 4.6L3.5 16.4A2 2 0 0 0 5.2 19.4h13.6a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const CrossIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
);

export const ChevronIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 10l5 5 5-5" />
  </svg>
);

/** The quiet attribution glyph: a seal with a notch. */
export const SealGlyph = ({ size = 14, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false} {...rest}>
    <path
      fill="currentColor"
      d="M12 1.8l2.4 1.7 2.9-.2 1.2 2.7 2.6 1.3-.2 2.9L22.6 12l-1.7 2.4.2 2.9-2.7 1.2-1.3 2.6-2.9-.2L12 22.6l-2.4-1.7-2.9.2-1.2-2.7-2.6-1.3.2-2.9L1.4 12l1.7-2.4-.2-2.9 2.7-1.2 1.3-2.6 2.9.2L12 1.8z"
      opacity=".22"
    />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M8 12.3l2.8 2.8L16.3 9" />
  </svg>
);

export const Spinner = ({ size = 18, ...rest }: IconProps) => (
  <svg className="facta-spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable={false} {...rest}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
