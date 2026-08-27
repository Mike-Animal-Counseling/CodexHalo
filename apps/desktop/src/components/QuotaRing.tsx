import { quotaTone } from "../lib/format";

export function QuotaRing({ value, label = "Weekly", quotaId = "weekly", size = 52, stroke = 4, showCenter = true, reducedMotion = false, glow = true }: {
  value: number | null;
  label?: string;
  quotaId?: "weekly" | "5h";
  size?: number;
  stroke?: number;
  showCenter?: boolean;
  reducedMotion?: boolean;
  glow?: boolean;
}) {
  const safe = value == null ? null : Math.max(0, Math.min(100, Math.round(value)));
  const center = size / 2;
  const radius = size * .39;
  const circumference = 2 * Math.PI * radius;
  const dash = ((safe ?? 0) / 100) * circumference;
  const bloomStroke = stroke * 3.15;
  const bodyStroke = stroke * 1.85;
  const trackStroke = Math.max(.65, stroke * .48);
  const highlightLength = Math.min(dash, circumference * .055);
  const highlightOffset = -Math.max(0, dash - highlightLength);
  const tone = quotaTone(safe);
  const progressTransition = reducedMotion ? "none" : "stroke-dasharray 900ms cubic-bezier(0.22, 1, 0.36, 1), stroke 500ms ease";
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`quota-ring quota-ring--${tone} ${glow ? "quota-ring--glow" : ""} ${size <= 40 ? "quota-ring--compact" : ""}`} role="img"
    aria-label={safe == null ? `${label} quota unavailable` : `${label} ${safe}% remaining`}>
    <circle className="quota-ring__rim" cx={center} cy={center} r={center - .65} strokeWidth={.48} />
    <g transform={`rotate(-90 ${center} ${center})`}>
      <circle className="quota-ring__track" cx={center} cy={center} r={radius} strokeWidth={trackStroke} />
      {safe != null && <>
        <circle className={`quota-ring__bloom quota-ring__bloom--${tone}`} cx={center} cy={center} r={radius} strokeWidth={bloomStroke}
          strokeDasharray={`${dash} ${circumference}`} style={{ transition: progressTransition }} />
        <circle className={`quota-ring__body quota-ring__body--${tone}`} cx={center} cy={center} r={radius} strokeWidth={bodyStroke}
          strokeDasharray={`${dash} ${circumference}`} style={{ transition: progressTransition }} />
        <circle className={`quota-ring__value quota-ring__value--${tone}`} data-quota={quotaId} cx={center} cy={center} r={radius} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference}`} style={{ transition: progressTransition }} />
        {highlightLength > 0 && <circle className="quota-ring__highlight" cx={center} cy={center} r={radius} strokeWidth={Math.max(.65, stroke * .38)}
          strokeDasharray={`${highlightLength} ${circumference}`} strokeDashoffset={highlightOffset}
          style={{ transition: progressTransition }} />}
      </>}
    </g>
    {showCenter && <text x={center} y={center} textAnchor="middle" dominantBaseline="central" className="quota-ring__text"
      style={{ fontSize: size * .31, fontWeight: 540, letterSpacing: "-0.025em" }}>
      {safe == null ? "—" : safe}{safe != null && <tspan dx="1" style={{ fontSize: size * .135, fontWeight: 520, opacity: .68 }}>%</tspan>}
    </text>}
  </svg>;
}
