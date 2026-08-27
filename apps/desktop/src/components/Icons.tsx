type IconProps = { size?: number; className?: string };

export function RefreshIcon({ size = 16, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.1 8.2A7 7 0 0 1 18.7 7M17.9 15.8A7 7 0 0 1 5.3 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>;
}

export function SlidersIcon({ size = 16, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="16" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="8" cy="17" r="2" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="10" cy="12" r="2" stroke="currentColor" strokeWidth="1.7" />
  </svg>;
}

export function CloseIcon({ size = 16 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>;
}

export function BackIcon({ size = 16, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m14.5 6-6 6 6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function ChevronIcon({ size = 14 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function InfoIcon({ size = 14, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 11v5M12 8.2v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}
