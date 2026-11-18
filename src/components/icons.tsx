import type { JSX, SVGProps } from "react";
import type { IconName } from "@/lib/service-catalog";

type P = SVGProps<SVGSVGElement>;

/** Ícones de traço (24x24, currentColor). Decorativos: `aria-hidden`; o texto ao lado informa o sentido. */
function Svg({ children, ...props }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-6 w-6 flex-none"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CarIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 16V12l1.7-4.3A2 2 0 0 1 8.6 6.4h6.8a2 2 0 0 1 1.9 1.3L19 12v4M3.5 16h17M5 16v2.5M19 16v2.5" />
    <circle cx="7.5" cy="14" r="0.6" />
    <circle cx="16.5" cy="14" r="0.6" />
    <path d="M6.5 12h11" />
  </Svg>
);
export const SeatIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.5c-1.3 0-2 .9-2 2.2L7 14c.1.9.8 1.5 1.7 1.5H15M7 14.2 5.5 20M15 15.5l1.5 4.5M15 15.5h3.4c.9 0 1.5.7 1.4 1.6l-.3 2.9" />
  </Svg>
);
export const PolisherIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 15.5h9a2.5 2.5 0 0 0 2.5-2.5v-1.5L19 9M4 15.5V19h9v-3.5M16 5l4 4M10 8.5h3" />
  </Svg>
);
export const SparklesIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
  </Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l7 2.6v5.7c0 4.3-2.8 7.6-7 9.7-4.2-2.1-7-5.4-7-9.7V5.6L12 3z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Svg>
);
export const WindIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 9h10.5a2.5 2.5 0 1 0-2.4-3.2M3 13h14a2.5 2.5 0 1 1-2.4 3.2M3 17h6" />
  </Svg>
);
export const DropIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c3.2 4 5.5 6.8 5.5 10A5.5 5.5 0 0 1 6.5 13.5c0-3.2 2.3-6 5.5-10z" />
  </Svg>
);
export const CalendarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Svg>
);
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const WrenchIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 6.2a4 4 0 0 0 4.9 4.9L20.7 12.4l-8.3 8.3a2.1 2.1 0 0 1-3-3l8.3-8.3-1.2-1.2z" />
    <path d="M14.5 6.2l2.6-2.6" />
  </Svg>
);
export const UserIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" />
  </Svg>
);
export const MailIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="M4 7.5l8 6 8-6" />
  </Svg>
);
export const PhoneIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 3.8h2.7l1.4 3.6-1.8 1.2a11 11 0 0 0 5.5 5.5l1.2-1.8 3.6 1.4v2.7a2 2 0 0 1-2.2 2A14.5 14.5 0 0 1 4.6 6a2 2 0 0 1 2-2.2z" />
  </Svg>
);
export const LockIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);
export const EyeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);
export const EyeOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 5.7A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.6M6.5 7.4A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const PencilIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 2.8 2.8L7.8 19 4 20zM14.5 6.5l3 3" />
  </Svg>
);
export const ChevronRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
  </Svg>
);
export const MenuIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

const SERVICE_ICONS: Record<IconName, (p: P) => JSX.Element> = {
  car: CarIcon,
  seat: SeatIcon,
  polisher: PolisherIcon,
  sparkles: SparklesIcon,
  shield: ShieldIcon,
  wind: WindIcon,
  drop: DropIcon,
};

export function ServiceIcon({ name, ...props }: { name: IconName } & P) {
  const Icon = SERVICE_ICONS[name];
  return <Icon {...props} />;
}
