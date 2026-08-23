interface HaloMeterProps {
  primary: number;
  secondary: number;
  size?: number;
  compact?: boolean;
}

const circleLength = (radius: number) => 2 * Math.PI * radius;

export function HaloMeter({ primary, secondary, size = 152, compact = false }: HaloMeterProps) {
  const outer = 64;
  const inner = 49;
  const outerLength = circleLength(outer);
  const innerLength = circleLength(inner);
  const safePrimary = Math.max(0, Math.min(100, primary));
  const safeSecondary = Math.max(0, Math.min(100, secondary));

  return (
    <div className={`halo-meter ${compact ? "halo-meter--compact" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 152 152" role="img" aria-label={`5 hour ${safePrimary}% remaining, week ${safeSecondary}% remaining`}>
        <defs>
          <filter id="halo-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform="rotate(-90 76 76)">
          <circle className="halo-track halo-track--outer" cx="76" cy="76" r={outer} />
          <circle className="halo-progress halo-progress--week" cx="76" cy="76" r={outer}
            strokeDasharray={outerLength} strokeDashoffset={outerLength * (1 - safeSecondary / 100)} />
          <circle className="halo-track halo-track--inner" cx="76" cy="76" r={inner} />
          <circle className="halo-progress halo-progress--primary" cx="76" cy="76" r={inner}
            strokeDasharray={innerLength} strokeDashoffset={innerLength * (1 - safePrimary / 100)} />
          <path className="halo-reset-tick" d="M76 6v8M76 19v7" />
        </g>
      </svg>
      {!compact && <div className="halo-center"><strong>{Math.round(safePrimary)}<span>%</span></strong><small>5H LEFT</small></div>}
    </div>
  );
}
