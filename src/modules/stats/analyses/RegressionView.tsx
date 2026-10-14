/**
 * Regression — linear, logistic, or Cox proportional hazards, chosen by the
 * outcome. Categorical predictors are dummy coded against their most frequent
 * level; incomplete rows are dropped and counted. Logistic models also report
 * discrimination (AUC) and a calibration-by-decile plot of the fitted risks.
 */

import { useMemo, useRef, useState } from "react";

import { apaP, binaryVector, buildDesign, columnByName, numericVector } from "../../../../shared/workbench/analysis";
import { isBinaryColumn } from "../../../../shared/workbench/dataset";
import { aucDeLong, coxRegression, linearRegression, logisticRegression } from "../../../../shared/stats";
import { ChartActions, ForestPlot, LineChart, ScatterPlot } from "../../../charts";
import { EmptyState, PaneBody, SegTabs } from "../../../shared-console/src";
import { Callout, ColumnSelect, plural, Field, ResultTable, Section, StatTile, fixed, formatP } from "../../../workstation/ui";
import { type AnalysisProps, AnalysisError, ConfigBar, ResultActions, attempt, labelOf } from "../common";
import { VariablePicker } from "../VariablePicker";

export type ModelKind = "linear" | "logistic" | "cox";

export function RegressionView({ ctx, initialKind }: AnalysisProps & { initialKind?: ModelKind }) {
  const { frame } = ctx;
  // Binary columns that look like outcomes (e.g. a second endpoint) are not default predictors.
  const isBinaryColumnOutcome = (name: string) => /event|death|mortality|outcome|incident/i.test(name);
  const role = (r: string) => frame.columns.find((column) => column.role === r && column.error === null)?.name ?? null;
  const [kind, setKind] = useState<ModelKind>(initialKind ?? (role("time") && role("event") ? "cox" : "logistic"));
  const [outcome, setOutcome] = useState<string | null>(() => {
    const out = frame.columns.find((column) => column.role === "outcome" && column.error === null);
    return out?.name ?? null;
  });
  const [time, setTime] = useState<string | null>(role("time"));
  const [event, setEvent] = useState<string | null>(role("event"));
  const [predictors, setPredictors] = useState<string[]>(() => {
    // Exposure and grouping variables first, then ordinary variables: a sensible first model.
    const usable = frame.columns.filter((column) => column.error === null && !["id", "outcome", "time", "event"].includes(column.role) && !isBinaryColumnOutcome(column.name));
    const ranked = [...usable.filter((c) => c.role === "exposure"), ...usable.filter((c) => c.role === "group"), ...usable.filter((c) => c.role === "none")];
    return ranked.slice(0, 4).map((column) => column.name);
  });

  // The modelled outcome (or time/event) can never also be a predictor.
  const excluded = kind === "cox" ? [time, event] : [outcome];
  const used = predictors.filter((name) => !excluded.includes(name));

  return (
    <>
      <ConfigBar>
        <Field label="Model">
          <SegTabs value={kind} onChange={setKind} options={[{ v: "linear", label: "Linear" }, { v: "logistic", label: "Logistic" }, { v: "cox", label: "Cox" }]} />
        </Field>
        {kind !== "cox" ? (
          <Field label={kind === "linear" ? "Outcome (numeric)" : "Outcome (0/1)"} htmlFor="reg-outcome">
            <ColumnSelect
              id="reg-outcome"
              frame={frame}
              value={outcome}
              onChange={setOutcome}
              filter={(column) => (kind === "linear" ? column.kind === "numeric" && !isBinaryColumn(column) : isBinaryColumn(column))}
              ariaLabel="Outcome"
            />
          </Field>
        ) : (
          <>
            <Field label="Follow-up time" htmlFor="reg-time">
              <ColumnSelect id="reg-time" frame={frame} value={time} onChange={setTime} kinds={["numeric"]} ariaLabel="Follow-up time" />
            </Field>
            <Field label="Event (0/1)" htmlFor="reg-event">
              <ColumnSelect id="reg-event" frame={frame} value={event} onChange={setEvent} filter={isBinaryColumn} ariaLabel="Event indicator" />
            </Field>
          </>
        )}
        <Field label="Predictors">
          <VariablePicker
            frame={frame}
            value={predictors}
            onChange={setPredictors}
            label="Predictors"
            filter={(column) => ![outcome, time, event].includes(column.name)}
            max={20}
          />
        </Field>
      </ConfigBar>
      <PaneBody>
        {used.length === 0 ? (
          <EmptyState title="Add at least one predictor" />
        ) : kind === "linear" && outcome ? (
          <LinearResult ctx={ctx} outcome={outcome} predictors={used} />
        ) : kind === "logistic" && outcome ? (
          <LogisticResult ctx={ctx} outcome={outcome} predictors={used} />
        ) : kind === "cox" && time && event ? (
          <CoxResult ctx={ctx} time={time} event={event} predictors={used} />
        ) : (
          <EmptyState title="Choose the outcome" hint={kind === "cox" ? "Cox regression needs a follow-up time and a 0/1 event column." : "Pick the outcome to model."} />
        )}
      </PaneBody>
    </>
  );
}

function DesignNotes({ excluded, dropped, n }: { excluded: number; dropped: { column: string; reason: string }[]; n: number }) {
  if (excluded === 0 && dropped.length === 0) return null;
  return (
    <div className="px-[11px] pt-2">
      <Callout tone="info">
        Complete-case analysis on {n.toLocaleString("en-US")} rows{excluded ? `; ${plural(excluded, "row")} with a missing value ${excluded === 1 ? "was" : "were"} excluded` : ""}.
        {dropped.map((entry) => ` ${entry.column} was dropped (${entry.reason}).`).join("")}
      </Callout>
    </div>
  );
}

function LinearResult({ ctx, outcome, predictors }: AnalysisProps & { outcome: string; predictors: string[] }) {
  const { frame, selection } = ctx;
  const forestRef = useRef<SVGSVGElement>(null);
  const residRef = useRef<SVGSVGElement>(null);
  const computed = useMemo(() => {
    const design = buildDesign(frame, selection.rows, predictors, [outcome]);
    const y = numericVector(columnByName(frame, outcome)!, design.rows);
    const fit = attempt(() => linearRegression(design.X, y, design.terms.map((t) => t.name)));
    return { design, y, fit };
  }, [frame, selection.rows, predictors, outcome]);
  const { design, y, fit } = computed;
  if (fit.error) return <AnalysisError error={fit.error} />;
  const model = fit.value!;
  const fitted = design.X.map((row) => model.coefficients[0].estimate + row.reduce((sum, value, index) => sum + value * model.coefficients[index + 1].estimate, 0));
  const terms = model.coefficients.slice(1);
  const significant = terms.filter((term) => term.p < 0.05);
  const usedColumns = [...new Set(design.terms.map((term) => term.column))];
  const summary = `A linear regression of ${outcome} on ${usedColumns.join(", ")} (n = ${model.n.toLocaleString("en-US")}) explained ${fixed(model.rSquared * 100, 1)}% of the variance (adjusted R² = ${fixed(model.adjRSquared, 3)}${model.fPValue !== null ? `; F(${model.fDf1}, ${model.fDf2}) = ${fixed(model.fStatistic, 2)}, ${apaP(model.fPValue)}` : ""}). ${
    significant.length
      ? significant.map((term) => `${term.name}: β = ${fixed(term.estimate, 3)} (95% CI ${fixed(term.ciLower, 3)} to ${fixed(term.ciUpper, 3)}), ${apaP(term.p)}`).join("; ") + "."
      : "No predictor was associated with the outcome at p < 0.05."
  }`;
  const rows = model.coefficients.map((term) => [term.name, fixed(term.estimate, 4), fixed(term.se, 4), `${fixed(term.ciLower, 3)} – ${fixed(term.ciUpper, 3)}`, fixed(term.t, 2), formatP(term.p)]);
  return (
    <>
      <ResultActions
        ctx={ctx}
        title={`Linear regression · ${labelOf(frame, outcome)}`}
        summary={summary}
        table={{ columns: ["Term", "β", "SE", "95% CI", "t", "p"], rows }}
        chart={{ type: "forest", data: { nullValue: 0, log: false, rows: terms.map((term) => ({ label: term.name, estimate: term.estimate, lower: term.ciLower, upper: term.ciUpper })) } }}
        extra={{ analysis: "linear-regression", outcome, predictors: usedColumns.join(", ") }}
      />
      <DesignNotes excluded={design.excluded} dropped={design.dropped} n={model.n} />
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label="R²" value={fixed(model.rSquared, 3)} sub={`adjusted ${fixed(model.adjRSquared, 3)}`} />
        <StatTile label="Model F-test" value={formatP(model.fPValue)} sub={model.fStatistic !== null ? `F = ${fixed(model.fStatistic, 2)}` : undefined} />
        <StatTile label="Residual SE" value={fixed(model.residualSe, 3)} sub={`n = ${model.n.toLocaleString("en-US")}, df = ${model.df.toLocaleString("en-US")}`} />
      </div>
      <Section title="Coefficients">
        <ResultTable columns={["Term", "β", "SE", "95% CI", "t", "p"]} rows={rows} />
      </Section>
      <Section title="Effect estimates (95% CI)">
        <ForestPlot
          ref={forestRef}
          title="Linear regression coefficients"
          rows={terms.map((term) => ({ label: term.name, estimate: term.estimate, lower: term.ciLower, upper: term.ciUpper, detail: `${fixed(term.estimate, 2)} (${fixed(term.ciLower, 2)}, ${fixed(term.ciUpper, 2)})`, p: term.p }))}
          nullValue={0}
          log={false}
          xLabel="β (change in outcome per unit)"
          actions={<ChartActions svgRef={forestRef} filename="linear-coefficients" />}
        />
      </Section>
      <Section title="Residuals vs fitted">
        <ScatterPlot
          ref={residRef}
          title="Residuals against fitted values"
          height={240}
          points={fitted.map((value, index) => ({ x: value, y: y[index] - value }))}
          xLabel="Fitted value"
          yLabel="Residual"
          fitLine={{ slope: 0, intercept: 0 }}
          actions={<ChartActions svgRef={residRef} filename="residuals" />}
        />
        <p className="m-0 mt-1 text-cap text-muted-fg">A shapeless band around zero supports linearity and constant variance; a funnel or curve suggests transforming a variable.</p>
      </Section>
    </>
  );
}

function LogisticResult({ ctx, outcome, predictors }: AnalysisProps & { outcome: string; predictors: string[] }) {
  const { frame, selection } = ctx;
  const forestRef = useRef<SVGSVGElement>(null);
  const calRef = useRef<SVGSVGElement>(null);
  const computed = useMemo(() => {
    const design = buildDesign(frame, selection.rows, predictors, [outcome]);
    const y = binaryVector(columnByName(frame, outcome)!, design.rows);
    const fit = attempt(() => logisticRegression(design.X, y, design.terms.map((t) => t.name)));
    let auc = null;
    let calibration: { predicted: number; observed: number; n: number }[] = [];
    if (fit.value) {
      const model = fit.value;
      const risk = design.X.map((row) => {
        const eta = model.coefficients[0].estimate + row.reduce((sum, value, index) => sum + value * model.coefficients[index + 1].estimate, 0);
        return 1 / (1 + Math.exp(-eta));
      });
      auc = attempt(() => aucDeLong(risk, y)).value;
      const order = risk.map((_, index) => index).sort((a, b) => risk[a] - risk[b]);
      for (let d = 0; d < 10; d += 1) {
        const slice = order.slice(Math.floor((d * order.length) / 10), Math.floor(((d + 1) * order.length) / 10));
        if (slice.length === 0) continue;
        calibration.push({
          predicted: slice.reduce((sum, index) => sum + risk[index], 0) / slice.length,
          observed: slice.reduce((sum, index) => sum + y[index], 0) / slice.length,
          n: slice.length,
        });
      }
    }
    return { design, fit, auc, calibration };
  }, [frame, selection.rows, predictors, outcome]);
  const { design, fit, auc, calibration } = computed;
  if (fit.error) return <AnalysisError error={fit.error} />;
  const model = fit.value!;
  const terms = model.coefficients.slice(1);
  const usedColumns = [...new Set(design.terms.map((term) => term.column))];
  const summary = `A logistic regression of ${outcome} (${model.events.toLocaleString("en-US")} events among ${model.n.toLocaleString("en-US")}) on ${usedColumns.join(", ")}: ${terms
    .map((term) => `${term.name} OR ${fixed(term.oddsRatio, 2)} (95% CI ${fixed(term.orLower, 2)}–${fixed(term.orUpper, 2)}, ${apaP(term.p)})`)
    .join("; ")}. ${auc ? `Discrimination: AUC ${fixed(auc.auc, 3)} (95% CI ${fixed(auc.lower, 3)}–${fixed(auc.upper, 3)}), apparent (not validated).` : ""} Events per predictor: ${fixed(model.events / Math.max(1, terms.length), 1)}.`;
  const rows = model.coefficients.map((term) => [term.name, fixed(term.estimate, 4), fixed(term.se, 4), term.name === "(Intercept)" ? "—" : fixed(term.oddsRatio, 3), term.name === "(Intercept)" ? "—" : `${fixed(term.orLower, 3)} – ${fixed(term.orUpper, 3)}`, formatP(term.p)]);
  const epv = model.events / Math.max(1, terms.length);
  return (
    <>
      <ResultActions
        ctx={ctx}
        title={`Logistic regression · ${labelOf(frame, outcome)}`}
        summary={summary}
        table={{ columns: ["Term", "log-odds", "SE", "OR", "95% CI", "p"], rows }}
        chart={{ type: "forest", data: { nullValue: 1, log: true, rows: terms.map((term) => ({ label: term.name, estimate: term.oddsRatio, lower: term.orLower, upper: term.orUpper })) } }}
        extra={{ analysis: "logistic-regression", outcome, predictors: usedColumns.join(", ") }}
      />
      <DesignNotes excluded={design.excluded} dropped={design.dropped} n={model.n} />
      {(model.separationWarning || !model.converged || epv < 10) && (
        <div className="px-[11px] pt-2">
          <Callout tone="warn">
            {model.separationWarning ? "Possible (quasi-)separation: some odds ratios may be unstable or infinite. " : ""}
            {!model.converged ? "The model did not converge. " : ""}
            {epv < 10 ? `Only ${fixed(epv, 1)} events per predictor — estimates may be overfitted (aim for ≥ 10).` : ""}
          </Callout>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label="AUC (apparent)" value={fixed(auc?.auc ?? null, 3)} sub={auc ? `95% CI ${fixed(auc.lower, 3)} – ${fixed(auc.upper, 3)}` : undefined} tone="var(--primary)" />
        <StatTile label="Events / n" value={`${model.events.toLocaleString("en-US")} / ${model.n.toLocaleString("en-US")}`} sub={`EPV ${fixed(epv, 1)}`} />
        <StatTile label="AIC" value={fixed(model.aic, 1)} sub={`deviance ${fixed(model.deviance, 1)}`} />
      </div>
      <Section title="Odds ratios (95% CI)">
        <ForestPlot
          ref={forestRef}
          title="Logistic regression odds ratios"
          rows={terms.map((term) => ({ label: term.name, estimate: term.oddsRatio, lower: term.orLower, upper: term.orUpper, detail: `${fixed(term.oddsRatio, 2)} (${fixed(term.orLower, 2)}–${fixed(term.orUpper, 2)})`, p: term.p }))}
          xLabel="Odds ratio (log scale)"
          actions={<ChartActions svgRef={forestRef} filename="odds-ratios" />}
        />
        <p className="m-0 mt-1 text-cap text-muted-fg">Odds ratios for numeric predictors are per one unit of the variable.</p>
      </Section>
      <Section title="Coefficients">
        <ResultTable columns={["Term", "log-odds", "SE", "OR", "95% CI", "p"]} rows={rows} />
      </Section>
      <Section title="Calibration by tenth of predicted risk">
        <LineChart
          ref={calRef}
          title="Calibration plot"
          height={240}
          series={[{ label: "Observed vs predicted", points: calibration.map((point) => ({ x: point.predicted, y: point.observed })) }]}
          xLabel="Mean predicted risk"
          yLabel="Observed event rate"
          xDomain={[0, Math.max(0.05, ...calibration.map((p) => Math.max(p.predicted, p.observed))) * 1.05]}
          yDomain={[0, Math.max(0.05, ...calibration.map((p) => Math.max(p.predicted, p.observed))) * 1.05]}
          diagonal
          legend={false}
          actions={<ChartActions svgRef={calRef} filename="calibration" />}
        />
        <p className="m-0 mt-1 text-cap text-muted-fg">Points on the diagonal mean predicted risks match observed rates in this sample (apparent calibration).</p>
      </Section>
    </>
  );
}

function CoxResult({ ctx, time, event, predictors }: AnalysisProps & { time: string; event: string; predictors: string[] }) {
  const { frame, selection } = ctx;
  const forestRef = useRef<SVGSVGElement>(null);
  const computed = useMemo(() => {
    const design = buildDesign(frame, selection.rows, predictors, [time, event]);
    const t = numericVector(columnByName(frame, time)!, design.rows);
    const e = binaryVector(columnByName(frame, event)!, design.rows);
    const fit = attempt(() => coxRegression(t, e, design.X, design.terms.map((term) => term.name)));
    return { design, fit };
  }, [frame, selection.rows, predictors, time, event]);
  const { design, fit } = computed;
  if (fit.error) return <AnalysisError error={fit.error} />;
  const model = fit.value!;
  const summary = `A Cox proportional-hazards model (${model.events.toLocaleString("en-US")} events among ${model.n.toLocaleString("en-US")}; likelihood-ratio χ²(${model.lrDf}) = ${fixed(model.likelihoodRatio, 2)}, ${apaP(model.lrPValue)}): ${model.coefficients
    .map((term) => `${term.name} HR ${fixed(term.hazardRatio, 2)} (95% CI ${fixed(term.hrLower, 2)}–${fixed(term.hrUpper, 2)}, ${apaP(term.p)})`)
    .join("; ")}.`;
  const rows = model.coefficients.map((term) => [term.name, fixed(term.estimate, 4), fixed(term.se, 4), fixed(term.hazardRatio, 3), `${fixed(term.hrLower, 3)} – ${fixed(term.hrUpper, 3)}`, formatP(term.p)]);
  return (
    <>
      <ResultActions
        ctx={ctx}
        title={`Cox regression · ${labelOf(frame, event)} over ${labelOf(frame, time)}`}
        summary={summary}
        table={{ columns: ["Term", "log-HR", "SE", "HR", "95% CI", "p"], rows }}
        chart={{ type: "forest", data: { nullValue: 1, log: true, rows: model.coefficients.map((term) => ({ label: term.name, estimate: term.hazardRatio, lower: term.hrLower, upper: term.hrUpper })) } }}
        extra={{ analysis: "cox-regression", time, event, predictors: predictors.join(", ") }}
      />
      <DesignNotes excluded={design.excluded} dropped={design.dropped} n={model.n} />
      {(model.separationWarning || !model.converged) && (
        <div className="px-[11px] pt-2">
          <Callout tone="warn">The model {model.converged ? "may have an infinite coefficient" : "did not converge"}; interpret the affected hazard ratios with care.</Callout>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 border-b border-border-2 px-[11px] py-2.5">
        <StatTile label="Events / n" value={`${model.events.toLocaleString("en-US")} / ${model.n.toLocaleString("en-US")}`} />
        <StatTile label="LR test" value={formatP(model.lrPValue)} sub={`χ² = ${fixed(model.likelihoodRatio, 2)}, df ${model.lrDf}`} />
        <StatTile label="Log-likelihood" value={fixed(model.logLik, 1)} sub={`null ${fixed(model.logLikNull, 1)}`} />
      </div>
      <Section title="Hazard ratios (95% CI)">
        <ForestPlot
          ref={forestRef}
          title="Cox hazard ratios"
          rows={model.coefficients.map((term) => ({ label: term.name, estimate: term.hazardRatio, lower: term.hrLower, upper: term.hrUpper, detail: `${fixed(term.hazardRatio, 2)} (${fixed(term.hrLower, 2)}–${fixed(term.hrUpper, 2)})`, p: term.p }))}
          xLabel="Hazard ratio (log scale)"
          actions={<ChartActions svgRef={forestRef} filename="hazard-ratios" />}
        />
      </Section>
      <Section title="Coefficients">
        <ResultTable columns={["Term", "log-HR", "SE", "HR", "95% CI", "p"]} rows={rows} />
        <p className="m-0 mt-1.5 text-cap text-muted-fg">Breslow method for ties. Check proportional hazards (e.g. Kaplan–Meier curves by group should not cross) before relying on a single HR.</p>
      </Section>
    </>
  );
}
