import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const Svg = ({ size = 16, children, ...rest }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const Bolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
  </Svg>
);
export const Flow = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="6" rx="2" />
    <rect x="14" y="15" width="7" height="6" rx="2" />
    <path d="M6.5 9v5a4 4 0 0 0 4 4H14" />
  </Svg>
);
export const Play = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5 19 12 7 19.5v-15Z" />
  </Svg>
);
export const History = (p: P) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const Users = (p: P) => (
  <Svg {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16.5 4.13a4 4 0 0 1 0 6.74" />
  </Svg>
);
export const Gauge = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 17a9 9 0 1 1 17 0" />
    <path d="m14.5 10.5-3 4" />
    <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);
export const Sparkles = (p: P) => (
  <Svg {...p}>
    <path d="M11 3.5 12.6 8 17 9.5 12.6 11 11 15.5 9.4 11 5 9.5 9.4 8 11 3.5Z" />
    <path d="M18 14.5 18.8 17l2.2.8-2.2.7-.8 2.5-.8-2.5-2.2-.7 2.2-.8.8-2.5Z" />
  </Svg>
);
export const Globe = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.7 5.8 3.7 9S14.5 18.3 12 21c-2.5-2.7-3.7-5.8-3.7-9S9.5 5.7 12 3Z" />
  </Svg>
);
export const Database = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
);
export const Bell = (p: P) => (
  <Svg {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z" />
    <path d="M10.5 20a1.8 1.8 0 0 0 3 0" />
  </Svg>
);
export const Split = (p: P) => (
  <Svg {...p}>
    <path d="M4 4h3l4.5 6M4 20h3l4.5-6" />
    <path d="M20 4h-3M20 20h-3" />
    <path d="m17 1.5 3 2.5-3 2.5M17 17.5l3 2.5-3 2.5" />
  </Svg>
);
export const ShieldCheck = (p: P) => (
  <Svg {...p}>
    <path d="M12 2.5 20 5.5v6c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-6l8-3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);
export const Check = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);
export const X = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
  </Svg>
);
export const Plus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const Trash = (p: P) => (
  <Svg {...p}>
    <path d="M4 6.5h16M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 20a1.3 1.3 0 0 0 1.3 1.2h6.6a1.3 1.3 0 0 0 1.3-1.2l.9-13.5" />
  </Svg>
);
export const ChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);
export const ChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m14.5 5.5-7 6.5 7 6.5" />
  </Svg>
);
export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9.5 5.5 7 6.5-7 6.5" />
  </Svg>
);
export const ArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Svg>
);
export const ArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" />
  </Svg>
);
export const Copy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6" />
  </Svg>
);
export const Clock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 1.9" />
  </Svg>
);
export const Sun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8M19.1 19.1l-1.8-1.8M6.7 6.7 4.9 4.9" />
  </Svg>
);
export const Moon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Svg>
);
export const Monitor = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7M12 16.5v4" />
  </Svg>
);
export const Menu = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const LogOut = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3h4" />
    <path d="M16 16.5 20.5 12 16 7.5M20 12H9.5" />
  </Svg>
);
export const Webhook = (p: P) => (
  <Svg {...p}>
    <path d="M9 8.5a3.5 3.5 0 1 1 5.2 3.05" />
    <path d="M14.2 11.55 17.5 17.5M9 8.5 5.6 14.4" />
    <circle cx="4.5" cy="17.5" r="2.5" />
    <circle cx="19" cy="17.5" r="2.5" />
    <path d="M7 17.5h9" />
  </Svg>
);
export const CalendarClock = (p: P) => (
  <Svg {...p}>
    <path d="M20 10.5V6.5A1.5 1.5 0 0 0 18.5 5h-13A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20H11" />
    <path d="M8 3v4M16 3v4M4 9.5h16" />
    <circle cx="17.5" cy="17.5" r="4" />
    <path d="M17.5 15.8v1.9l1.3.8" />
  </Svg>
);
export const Cursor = (p: P) => (
  <Svg {...p}>
    <path d="m5 3 6.5 17 2.4-6.9 6.9-2.4L5 3Z" />
  </Svg>
);
export const Info = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </Svg>
);
export const Alert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 22 20H2L12 3.5Z" />
    <path d="M12 10v4.2M12 17.3v.2" />
  </Svg>
);
export const Lock = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const Layers = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
    <path d="m3 12.5 9 4.5 9-4.5" />
  </Svg>
);
export const Pause = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="5" width="3.5" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1.2" />
  </Svg>
);
export const Loader = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M18.4 5.6l-2.9 2.9M8.5 15.5l-2.9 2.9" />
  </Svg>
);

/** Step-type glyphs, keyed the same way the engine keys step types. */
export const STEP_ICON: Record<string, (p: P) => React.ReactElement> = {
  llm_call: Sparkles,
  http_request: Globe,
  db_write: Database,
  notify: Bell,
  conditional_branch: Split,
  approval_gate: ShieldCheck,
};

export const TRIGGER_ICON: Record<string, (p: P) => React.ReactElement> = {
  manual: Cursor,
  webhook: Webhook,
  scheduled: CalendarClock,
  database_event: Database,
};
