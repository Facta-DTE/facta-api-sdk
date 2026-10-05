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

/** The seal's scalloped outline: a circle with 12 gentle lobes. */
function rosette(lobes = 12, radius = 10, amplitude = 1.1): string {
  let d = "";
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 2;
    const r = radius + amplitude * Math.cos(lobes * t);
    d += `${i ? "L" : "M"}${(12 + r * Math.sin(t)).toFixed(2)} ${(12 - r * Math.cos(t)).toFixed(2)}`;
  }
  return d + "Z";
}

const ROSETTE = rosette();

/** The quiet attribution glyph: the seal outline with its check. */
export const SealGlyph = ({ size = 14, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden focusable={false} {...rest}>
    <path d={ROSETTE} />
    <path d="M8.2 12.4l2.6 2.6 5-5.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The filled seal of the sealed screen; the check is cut out in the window colour. */
export const SealBig = ({ size = 40, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false} {...rest}>
    <path d={ROSETTE} fill="currentColor" />
    <path d="M8 12.3l3 3 5.2-5.6" fill="none" stroke="var(--facta-i-bg)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const DocIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.75}>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
    <path d="M14 3.5V8h4M9 13h6M9 16.5h4" />
  </svg>
);

export const HourIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.75}>
    <path d="M7 4h10M7 20h10M8 4c0 4 4 5 4 8s-4 4-4 8M16 4c0 4-4 5-4 8s4 4 4 8" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.75}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.01" />
  </svg>
);

export const Spinner = ({ size = 18, ...rest }: IconProps) => (
  <svg className="facta-spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable={false} {...rest}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
