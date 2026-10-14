import { forwardRef } from "react";
import type { ReactNode } from "react";
import { ChartFrame, useChartShell } from "./ChartFrame";
import type { ChartBaseProps } from "./ChartFrame";
import { clamp, formatPercent } from "./scales";
import { truncateText, wrapText } from "./text";

export interface AttritionStep {
  label: string;
  kind: "include" | "exclude";
  /** N remaining after this step. */
  remaining: number;
  /** Total N removed by this step (includes `missing`). */
  excluded: number;
  /** Of `excluded`, how many were removed for missing data. */
  missing?: number;
  /** Disabled steps are drawn muted/dashed and pass N through unchanged. */
  disabled?: boolean;
}
export interface AttritionFlowProps extends Omit<ChartBaseProps, "height"> {
  start: { label: string; n: number };
  steps: AttritionStep[];
  final?: { label: string };
  onStepClick?: (index: number) => void;
  activeStep?: number;
  /** Minimum height; the diagram grows with its steps. */
  height?: number;
}

const PAD_X = 9;
const PAD_Y = 7;
const LINE = 14;
const LABEL_FONT = 11;
const SUB_FONT = 10;
const N_FONT = 10.5;

const fmtN = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");

interface BoxSpec {
  key: string;
  lines: string[];
  sub: string;
  full: string;
  variant: "start" | "step" | "disabled" | "final";
  stepIndex?: number;
  side?: { title: string; lines: string[] };
}

export const AttritionFlow = forwardRef<SVGSVGElement, AttritionFlowProps>(function AttritionFlow(
  { title, start, steps, final, onStepClick, activeStep, height = 0, actions, className },
  ref,
) {
  const { wrapRef, plotRef, width, tooltip } = useChartShell();
  const empty = !Number.isFinite(start.n);

  const mainW = clamp(Math.floor(width * 0.46), 140, 320);
  const mainX = 1;
  const sideX = mainX + mainW + 32;
  const sideW = clamp(width - sideX - 2, 80, 360);
  const textW = mainW - PAD_X * 2;
  const sideTextW = sideW - PAD_X * 2;
  const pct = (n: number) => (start.n > 0 ? ` (${formatPercent(n / start.n, 1)})` : "");

  const boxes: BoxSpec[] = [
    { key: "start", lines: wrapText(start.label, textW, LABEL_FONT, 3), sub: `n = ${fmtN(start.n)}`, full: start.label, variant: "start" },
  ];
  steps.forEach((s, i) => {
    // CONSORT wording: the main box describes who remains, the side box says why
    // the others left — the criterion itself and, separately, missing data.
    const byCriterion = s.excluded - (s.missing ?? 0);
    const reason = s.kind === "include" ? `Did not meet: ${s.label}` : s.label;
    const sideText =
      s.missing != null && s.missing > 0
        ? `${reason} (n = ${fmtN(byCriterion)}); missing data (n = ${fmtN(s.missing)})`
        : `${reason} (n = ${fmtN(byCriterion)})`;
    const mainLabel = s.kind === "include" ? `Meeting: ${s.label}` : `After excluding: ${s.label}`;
    boxes.push({
      key: `s${i}`,
      lines: wrapText(mainLabel, textW, LABEL_FONT, 3),
      sub: s.disabled ? `skipped · n = ${fmtN(s.remaining)}` : `n = ${fmtN(s.remaining)}${pct(s.remaining)}`,
      full: `${s.kind === "include" ? "Include" : "Exclude"}: ${s.label}`,
      variant: s.disabled ? "disabled" : "step",
      stepIndex: i,
      side: s.disabled ? undefined : { title: `Excluded n = ${fmtN(s.excluded)}`, lines: wrapText(sideText, sideTextW, SUB_FONT, 3) },
    });
  });
  if (final) {
    const last = steps.length ? steps[steps.length - 1].remaining : start.n;
    boxes.push({ key: "final", lines: wrapText(final.label, textW, LABEL_FONT, 3), sub: `n = ${fmtN(last)}${pct(last)}`, full: final.label, variant: "final" });
  }

  // Vertical layout: [gap (with optional side box)] [main box] …
  let y = 1;
  const placed = boxes.map((b, i) => {
    const boxH = PAD_Y * 2 + b.lines.length * LINE + LINE;
    const sideH = b.side ? PAD_Y * 2 + LINE + b.side.lines.length * (LINE - 1) : 0;
    const gapH = i === 0 ? 0 : b.side ? Math.max(30, sideH + 14) : 22;
    const gapTop = y;
    y += gapH;
    const boxY = y;
    y += boxH;
    return { b, boxY, boxH, gapTop, gapH, sideH };
  });
  const totalH = Math.max(height, Math.ceil(y + 1));
  const cx = mainX + mainW / 2;

  const box = (p: (typeof placed)[number]): ReactNode => {
    const { b, boxY, boxH } = p;
    const active = b.stepIndex != null && b.stepIndex === activeStep;
    const clickable = onStepClick && b.stepIndex != null;
    const disabled = b.variant === "disabled";
    const stroke = active ? "var(--primary)" : b.variant === "final" ? "var(--fg)" : "var(--border)";
    const fill = active ? "var(--primary-soft)" : disabled ? "transparent" : b.variant === "final" ? "var(--card-2)" : "var(--card)";
    const ink = disabled ? "var(--muted-fg)" : "var(--fg)";
    return (
      <g
        key={b.key}
        data-mark="flow-box"
        data-variant={b.variant}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? "button" : undefined}
        aria-label={clickable ? `${b.full}, ${b.sub}` : undefined}
        aria-pressed={clickable ? active : undefined}
        style={{ cursor: clickable ? "pointer" : undefined }}
        onClick={clickable ? () => onStepClick(b.stepIndex as number) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onStepClick(b.stepIndex as number);
                }
              }
            : undefined
        }
      >
        <title>{`${b.full} — ${b.sub}`}</title>
        <rect
          x={mainX + 0.5}
          y={boxY + 0.5}
          width={mainW - 1}
          height={boxH - 1}
          rx={6}
          fill={fill}
          stroke={stroke}
          strokeWidth={active || b.variant === "final" ? 1.5 : 1}
          strokeDasharray={disabled ? "4 3" : undefined}
        />
        {b.lines.map((l, k) => (
          <text key={k} x={mainX + PAD_X} y={boxY + PAD_Y + LINE * k + 10} fontSize={LABEL_FONT} fill={ink} fontWeight={b.variant === "final" ? 600 : 400}>
            {l}
          </text>
        ))}
        <text
          x={mainX + PAD_X}
          y={boxY + PAD_Y + LINE * b.lines.length + 10}
          fontSize={N_FONT}
          className="ui-mono"
          fill={disabled ? "var(--muted-fg)" : "var(--fg-strong)"}
          fontWeight={disabled ? 400 : 600}
        >
          {truncateText(b.sub, textW, N_FONT, true)}
        </text>
      </g>
    );
  };

  return (
    <ChartFrame
      ref={ref}
      title={title}
      width={width}
      height={empty ? Math.max(height, 120) : totalH}
      wrapRef={wrapRef}
      plotRef={plotRef}
      tip={tooltip.tip}
      empty={empty}
      actions={actions}
      className={className}
    >
      {placed.map((p, i) => {
        if (i === 0) return null;
        const prev = placed[i - 1];
        const y0 = prev.boxY + prev.boxH;
        const y1 = p.boxY;
        const midY = p.gapTop + p.gapH / 2;
        const disabled = p.b.variant === "disabled";
        return (
          <g key={`a${i}`} aria-hidden>
            <line x1={cx + 0.5} x2={cx + 0.5} y1={y0} y2={y1 - 5} stroke="var(--muted-fg)" strokeDasharray={disabled ? "3 3" : undefined} />
            <path d={`M${cx + 0.5},${y1} l-4,-6 h8 z`} fill="var(--muted-fg)" />
            {p.b.side && (
              <g data-mark="flow-side">
                <line x1={cx + 0.5} x2={sideX - 5} y1={midY + 0.5} y2={midY + 0.5} stroke="var(--muted-fg)" />
                <path d={`M${sideX},${midY + 0.5} l-6,-4 v8 z`} fill="var(--muted-fg)" />
                <rect
                  x={sideX + 0.5}
                  y={midY - p.sideH / 2 + 0.5}
                  width={sideW - 1}
                  height={p.sideH - 1}
                  rx={6}
                  fill="var(--card-2)"
                  stroke="var(--border)"
                />
                <text x={sideX + PAD_X} y={midY - p.sideH / 2 + PAD_Y + 10} fontSize={SUB_FONT + 0.5} fill="var(--fg)" className="ui-mono">
                  {truncateText(p.b.side.title, sideTextW, SUB_FONT + 0.5, true)}
                </text>
                {p.b.side.lines.map((l, k) => (
                  <text
                    key={k}
                    x={sideX + PAD_X}
                    y={midY - p.sideH / 2 + PAD_Y + 10 + LINE + (LINE - 1) * k}
                    fontSize={SUB_FONT}
                    fill="var(--muted-fg)"
                  >
                    {l}
                  </text>
                ))}
              </g>
            )}
          </g>
        );
      })}
      {placed.map(box)}
    </ChartFrame>
  );
});
