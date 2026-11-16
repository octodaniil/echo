// Small inline icons (24x24, stroke-based) so we don't ship an icon library.
import type { JSX } from 'preact';

type Props = JSX.SVGAttributes<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: Props & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 17v4" />
  </Icon>
);

export const MicOffIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
    <path d="M19 10a7 7 0 0 1-.9 3.4M5 10a7 7 0 0 0 11.6 5.3" />
    <path d="M12 17v4" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const HeadphonesIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
  </Icon>
);

export const HeadphonesOffIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 18v-6a9 9 0 0 1 14.5-7.1M20.4 8.5A9 9 0 0 1 21 12v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const HangUpIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 15.5c5-4.7 13-4.7 18 0l-2.3 2.3-3.2-1.3v-2.6a10 10 0 0 0-7 0v2.6l-3.2 1.3z" />
  </Icon>
);

export const VolumeIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </Icon>
);

export const PlusIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const UserPlusIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0" />
    <path d="M19 8v6M16 11h6" />
  </Icon>
);

export const LogOutIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Icon>
);

export const ScreenIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);
