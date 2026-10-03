const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.7',
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  'aria-hidden': 'true'
};

function Svg({ children, className }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} {...base}>
      {children}
    </svg>
  );
}

/** Official stacked-frames mark (stroke version for inline UI) */
export function IconMark({ className }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill="#0f1720" />
      <rect x="7" y="10" width="13" height="15" fill="none" stroke="#fff" strokeWidth="1.75" />
      <rect x="12" y="7" width="13" height="15" fill="none" stroke="#fff" strokeWidth="1.75" />
      <path d="M15 14.5l6 3.5-6 3.5v-7z" fill="#fff" />
    </svg>
  );
}

/** Film strip for reels / media */
export function IconReels({ className }) {
  return (
    <Svg className={className}>
      <rect x="4" y="3" width="16" height="18" />
      <path d="M4 8h16M4 16h16M8 3v5M16 3v5M8 16v5M16 16v5" />
    </Svg>
  );
}

/** Stepped speaker — audio */
export function IconAudio({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 9h4l5-4v14l-5-4H4V9z" />
      <path d="M16 9v6M19 7v10" />
    </Svg>
  );
}

/** Interlocking boxes — link */
export function IconLink({ className }) {
  return (
    <Svg className={className}>
      <rect x="3" y="8" width="8" height="8" />
      <rect x="13" y="8" width="8" height="8" />
      <path d="M9 12h6" />
    </Svg>
  );
}

/** Folded board — paste / clipboard */
export function IconPaste({ className }) {
  return (
    <Svg className={className}>
      <path d="M8 5h8v3H8z" />
      <rect x="5" y="6" width="14" height="14" />
      <path d="M9 12h6M9 15h4" />
    </Svg>
  );
}

/** Tray + chevron — download */
export function IconDownload({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 19h14" />
    </Svg>
  );
}

/** Two offset squares — copy */
export function IconCopy({ className }) {
  return (
    <Svg className={className}>
      <rect x="8" y="8" width="11" height="11" />
      <path d="M5 16V5h11" />
    </Svg>
  );
}

/** Equalizer bars — soundtrack */
export function IconWave({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 14v-4M8 18V6M12 16V8M16 19V5M20 13V11" />
    </Svg>
  );
}

/** Square alert */
export function IconAlert({ className }) {
  return (
    <Svg className={className}>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </Svg>
  );
}

/** X — clear field */
export function IconClear({ className }) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

/** Boxy loop — download again */
export function IconAgain({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 10V5h5" />
      <path d="M4 5l6 6" />
      <path d="M5 9h14v10H5V9z" />
    </Svg>
  );
}

function IconShare({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6h14v-6" />
    </Svg>
  );
}

function IconUnlock({ className }) {
  return (
    <Svg className={className}>
      <rect x="5" y="12" width="14" height="9" />
      <path d="M16 12V7.2a4.2 4.2 0 0 0-8.4-.2" />
    </Svg>
  );
}

function IconDevice({ className }) {
  return (
    <Svg className={className}>
      <rect x="7" y="3" width="10" height="18" />
      <path d="M11 18h2" />
    </Svg>
  );
}

function IconSun({ className }) {
  return (
    <Svg className={className}>
      <rect x="8" y="8" width="8" height="8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Svg>
  );
}

function IconMoon({ className }) {
  return (
    <Svg className={className}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </Svg>
  );
}

const ICONS = {
  mark: IconMark,
  reels: IconReels,
  audio: IconAudio,
  link: IconLink,
  paste: IconPaste,
  download: IconDownload,
  copy: IconCopy,
  wave: IconWave,
  alert: IconAlert,
  clear: IconClear,
  again: IconAgain,
  share: IconShare,
  unlock: IconUnlock,
  device: IconDevice,
  sun: IconSun,
  moon: IconMoon
};

export function Icon({ name, className }) {
  const Cmp = ICONS[name];
  return Cmp ? <Cmp className={className} /> : null;
}
