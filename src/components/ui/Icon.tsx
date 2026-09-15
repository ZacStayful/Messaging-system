import type { SVGProps } from "react";

/** Line icons traced from the design prototype (24x24 viewBox). */
export const ICON_PATHS = {
  back: "M15 5l-7 7 7 7",
  forward: "M9 5l7 7-7 7",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17h.01",
  home: "M3 11 12 3l9 8v10h-6v-6H9v6H3z",
  dms: "M21 12a8 8 0 0 1-11.6 7.1L4 21l1.6-4.6A8 8 0 1 1 21 12z",
  activity: "M6 17V11a6 6 0 1 1 12 0v6l2 2H4l2-2zM10 21h4",
  files: "M4 7h6l2 2h8v11H4zM4 11h16",
  later: "M6 3h12v18l-6-4-6 4z",
  agents: "M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2 2M15.5 15.5l2 2M6.5 17.5l2-2M15.5 8.5l2-2",
  you: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  plus: "M12 5v14M5 12h14",
  sun: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  pencil: "M4 20h4l11-11-4-4L4 16zM13 7l4 4",
  filter: "M4 6h16M4 12h10M4 18h6",
  chevronDown: "M6 9l6 6 6-6",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  star: "M12 3l2.8 6 6.2.7-4.6 4.3 1.3 6.3L12 17l-5.7 3.3 1.3-6.3L3 9.7 9.2 9z",
  huddle: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z",
  bell: "M6 17V11a6 6 0 1 1 12 0v6l2 2H4l2-2zM10 21h4",
  bellOff: "M6 17V11a6 6 0 0 1 9-5.3M18 11v6l2 2H4l2-2M10 21h4M4 4l16 16",
  more: "M12 5.5h.01M12 12h.01M12 18.5h.01",
  close: "M6 6l12 12M18 6L6 18",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  messages: "M12 3a9 9 0 0 0-7.8 13.5L3 21l4.5-1.2A9 9 0 1 0 12 3z",
  canvas: "M5 4h14v16H5zM8 9h8M8 13h5",
  file: "M13 3H6v18h12V8zM13 3v5h5",
  pin: "M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7",
  emoji: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  mention: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  video: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM5 11a7 7 0 0 0 14 0M12 18v3",
  slash: "M4 4h16v16H4zM14 8l-4 8",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5",
  audio: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6",
  drive: "M8.5 4h7l6 10.5-3.5 6H6L2.5 14.5zM8.5 4l6 10.5M15.5 4l-6 10.5M2.5 14.5h19",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  image: "M4 5h16v14H4zM8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4",
  check: "M5 12l5 5L20 7",
  retry: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  logout: "M10 17l5-5-5-5M15 12H3M21 3v18",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff:
    "M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A16.7 16.7 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.3-1",
  key: "M15 7a4 4 0 1 1-2.6 7L11 15.4V18H8.6L8 19H5v-3l6-6A4 4 0 0 1 15 7zM15.5 8.5h.01",
  userPlus: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  mail: "M4 5h16v14H4zM4 6l8 7 8-7",
  camera: "M4 8h4l2-3h4l2 3h4v11H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  smilePlus: "M20.5 13A8.5 8.5 0 1 1 11 3.5M8.5 14s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M14 9.5h.01M18 2v6M15 5h6",
  stop: "M6 6h12v12H6z",
  play: "M8 5v14l11-7z",
  pause: "M7 5h4v14H7zM13 5h4v14h-4z",
  download: "M12 4v12M6 10l6 6 6-6M4 20h16",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  at: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  hash: "M5 9h14M5 15h14M10 4L8 20M16 4l-2 16",
  upload: "M12 16V4M6 10l6-6 6 6M4 20h16",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
} as const;

export type IconName = keyof typeof ICON_PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  filled?: boolean;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, filled = false, style, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", flexShrink: 0, ...style }}
      {...rest}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
