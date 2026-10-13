/**
 * Clinical Calculators — a reference library of validated bedside formulas.
 *
 * Each calculator computes for one patient with unit conversion and range
 * checks, shows its formula as typeset maths with the primary citations, and
 * bridges to the data: map its inputs onto the active dataset's columns to
 * create a derived variable, or open the mapped formula as puzzle pieces in
 * Score Forge.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Puzzle, RotateCcw, TableProperties } from "lucide-react";

import {
  CALCULATORS,
  CALC_CATEGORIES,
  type BandTone,
  type CalcInput,
  type Calculator,
  computeCalculator,
  findCalculator,
} from "../../../shared/workbench/calculators";
import { type Frame, distinctValues } from "../../../shared/workbench/dataset";
import { evaluateColumn } from "../../../shared/workbench/expr";
import { exprToLatex } from "../../../shared/workbench/exprLatex";
import { printExpr } from "../../../shared/workbench/exprText";
import { FormulaPreview } from "../../formula/FormulaPreview";
import {
  Chip,
  EmptyState,
  MasterListGroup,
  MasterListItem,
  MasterListPane,
  MasterListSearch,
  Page,
  Pane,
  PaneBody,
  PaneHeader,
  ghostBtn,
  inputSmCls,
  matchesMasterListSearch,
  pillBtn,
  primaryBtn,
  selectSmCls,
  useMobile,
} from "../../shared-console/src";
import { wbApi } from "../../workstation/api";
import { useActiveDataset, useFrame } from "../../workstation/data";
import { Callout, Field, Section, fmt } from "../../workstation/ui";
import { DerivedDialog } from "../data/DerivedDialog";
import { type InputMapping, guessMapping, guessUnit, guessYesValue, isZeroOne, mappedExpression } from "./mapping";

const TONE: Record<BandTone, string> = {
  ok: "var(--risk-low)",
  info: "var(--info)",
  warn: "var(--warn)",
  bad: "var(--bad)",
};

export default function CalculatorsPage() {
  const { calculatorKey } = useParams<{ calculatorKey: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const calc = findCalculator(calculatorKey ?? "") ?? CALCULATORS[0];

  const filtered = CALCULATORS.filter((entry) => matchesMasterListSearch(search, entry.name, entry.short, entry.summary, entry.category));

  return (
    <Page>
      <MasterListPane
        label="Calculators"
        count={CALCULATORS.length}
        toolbar={<MasterListSearch value={search} onChange={setSearch} placeholder="Search eGFR, MELD, QTc…" />}
        footer={<span>Research & education — not a medical device</span>}
      >
        {CALC_CATEGORIES.map((category) => {
          const entries = filtered.filter((entry) => entry.category === category);
          if (entries.length === 0) return null;
          return (
            <MasterListGroup key={category} label={category} count={entries.length}>
              {entries.map((entry) => (
                <MasterListItem
                  key={entry.key}
                  active={entry.key === calc.key}
                  primary={entry.name}
                  tooltip={entry.summary}
                  onClick={() => navigate(`/calculators/${entry.key}`)}
                />
              ))}
            </MasterListGroup>
          );
        })}
        {filtered.length === 0 && <EmptyState title="No calculators match" hint={`Nothing for “${search}”.`} />}
      </MasterListPane>
      <CalculatorDetail key={calc.key} calc={calc} focusOnMount={Boolean(calculatorKey)} />
    </Page>
  );
}

function defaultValues(calc: Calculator): Record<string, number | boolean | null> {
  return Object.fromEntries(calc.inputs.map((input) => [input.name, input.defaultValue ?? (input.kind === "boolean" ? false : null)]));
}

function CalculatorDetail({ calc, focusOnMount }: { calc: Calculator; focusOnMount: boolean }) {
  const [values, setValues] = useState<Record<string, number | boolean | null>>(() => defaultValues(calc));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, number>>({});
  const result = useMemo(() => computeCalculator(calc, values, units), [calc, values, units]);
  const top = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  // On phones the list and the calculator stack; bring the chosen calculator into view.
  useEffect(() => {
    if (mobile && focusOnMount) top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [mobile, focusOnMount]);
  const anyEntered = calc.inputs.some((input) => input.kind === "number" && !input.options && values[input.name] !== null && values[input.name] !== undefined);
  const issueFor = (name: string) => result.issues.find((issue) => issue.name === name);
  const suspect = result.issues.some((issue) => issue.level === "warning");

  const setNumber = (input: CalcInput, text: string) => {
    setDrafts((current) => ({ ...current, [input.name]: text }));
    const parsed = text.trim() === "" ? null : Number(text);
    setValues((current) => ({ ...current, [input.name]: parsed === null || Number.isFinite(parsed) ? parsed : null }));
  };

  return (
    <>
      <Pane>
        <PaneHeader label={calc.category}>
          <button
            type="button"
            className={`${ghostBtn} gap-1`}
            onClick={() => {
              setValues(defaultValues(calc));
              setDrafts({});
              setUnits({});
            }}
          >
            <RotateCcw size={11} aria-hidden /> <span className="text-label">Reset</span>
          </button>
        </PaneHeader>
        <PaneBody>
          <div ref={top} className="mx-auto w-full max-w-[860px] px-4 py-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="m-0 text-[18px] font-semibold text-fg-strong">{calc.name}</h2>
              <Chip label={calc.short} color="var(--primary)" />
            </div>
            <p className="m-0 mt-1 text-ui text-muted-fg">{calc.summary}</p>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 mobile:grid-cols-1">
              {calc.inputs.map((input) => {
                const issue = issueFor(input.name);
                const id = `calc-${calc.key}-${input.name}`;
                if (input.kind === "boolean") {
                  return (
                    <label key={input.name} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border-2 bg-card-2 px-2.5 py-2 text-ui text-fg hover:bg-muted">
                      <input
                        id={id}
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--primary)]"
                        checked={values[input.name] === true}
                        onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.checked }))}
                      />
                      {input.label}
                    </label>
                  );
                }
                if (input.options) {
                  return (
                    <Field key={input.name} label={input.label} htmlFor={id}>
                      <select
                        id={id}
                        className={`${selectSmCls} h-8 text-ui`}
                        value={String(values[input.name] ?? "")}
                        onChange={(event) => setValues((current) => ({ ...current, [input.name]: Number(event.target.value) }))}
                      >
                        {input.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                }
                return (
                  <Field
                    key={input.name}
                    label={`${input.label}${input.optional ? " (optional)" : ""}`}
                    htmlFor={id}
                    hint={
                      issue && (drafts[input.name] ?? "") !== "" ? (
                        <span style={{ color: issue.level === "error" ? "var(--bad)" : "var(--warn)" }}>{issue.message}</span>
                      ) : input.plausible ? (
                        (() => {
                          const unit = input.units?.[units[input.name] ?? 0];
                          const factor = unit?.factor ?? 1;
                          const r = (bound: number) => Number((bound / factor).toPrecision(3));
                          return `Usual range ${r(input.plausible[0])}–${r(input.plausible[1])} ${unit?.label ?? input.unit ?? ""}`;
                        })()
                      ) : undefined
                    }
                  >
                    <div className="flex gap-1.5">
                      <input
                        id={id}
                        inputMode="decimal"
                        className={`${inputSmCls} ui-num h-8 min-w-0 flex-1 text-ui`}
                        value={drafts[input.name] ?? (typeof values[input.name] === "number" ? String(values[input.name]) : "")}
                        onChange={(event) => setNumber(input, event.target.value)}
                        aria-invalid={issue?.level === "error" && (drafts[input.name] ?? "") !== ""}
                        style={issue && (drafts[input.name] ?? "") !== "" ? { borderColor: issue.level === "error" ? "var(--bad)" : "var(--warn)" } : undefined}
                      />
                      {input.units && input.units.length > 1 ? (
                        <select
                          aria-label={`${input.label} unit`}
                          className={`${selectSmCls} h-8 w-[104px] flex-none`}
                          value={units[input.name] ?? 0}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            const before = input.units![units[input.name] ?? 0].factor;
                            const after = input.units![next].factor;
                            // Convert the entered value so the quantity stays the same in the new unit.
                            const current = values[input.name];
                            if (typeof current === "number") {
                              const converted = Number(((current * before) / after).toPrecision(5));
                              setValues((all) => ({ ...all, [input.name]: converted }));
                              setDrafts((all) => ({ ...all, [input.name]: String(converted) }));
                            }
                            setUnits((all) => ({ ...all, [input.name]: next }));
                          }}
                        >
                          {input.units.map((unit, index) => (
                            <option key={unit.label} value={index}>
                              {unit.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        input.unit && <span className="ui-mono flex h-8 w-[104px] flex-none items-center text-label text-muted-fg">{input.unit}</span>
                      )}
                    </div>
                  </Field>
                );
              })}
            </div>

            {suspect && (
              <Callout tone="warn" className="mt-5">
                Some inputs are outside their usual range — check them before interpreting the result.
              </Callout>
            )}
            <div className="mt-3 grid gap-2 mobile:!grid-cols-1" style={{ gridTemplateColumns: `repeat(${Math.min(result.outputs.length, 3)}, minmax(0, 1fr))`, opacity: suspect ? 0.55 : 1 }}>
              {result.outputs.map(({ output, value, band }, index) => (
                <div
                  key={output.key}
                  className="rounded-[10px] border bg-card p-3"
                  style={{ borderColor: band ? `color-mix(in srgb, ${TONE[band.tone]} 45%, var(--border))` : "var(--border)" }}
                  aria-live={index === 0 ? "polite" : undefined}
                >
                  <div className="text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">{output.label}</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="ui-mono text-[26px] font-semibold leading-none text-fg-strong">
                      {value === null ? "—" : value.toFixed(output.decimals)}
                    </span>
                    {output.unit && <span className="text-label text-muted-fg">{output.unit}</span>}
                  </div>
                  {band && !suspect && (
                    <div className="mt-2 text-body font-medium" style={{ color: TONE[band.tone] }}>
                      {band.label}
                    </div>
                  )}
                  {band && suspect && <div className="mt-2 text-body text-muted-fg">Interpretation withheld</div>}
                </div>
              ))}
            </div>
            {!anyEntered && calc.inputs.some((input) => input.kind === "number" && !input.options) && (
              <p className="m-0 mt-2 text-cap text-muted-fg">Enter the values above — results update as you type.</p>
            )}
            {result.checks.map((message) => (
              <Callout key={message} tone="warn" className="mt-2">
                {message}
              </Callout>
            ))}
            {result.alerts.map((message) => (
              <Callout key={message} tone="bad" className="mt-2">
                {message}
              </Callout>
            ))}

            <h3 className="mb-1.5 mt-6 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Formula</h3>
            {calc.outputs.map((output) => (
              <div key={output.key} className="mb-2">
                <div className="mb-0.5 text-label font-medium text-fg">{output.label}</div>
                <FormulaPreview latex={exprToLatex(output.expr)} variant="card" />
              </div>
            ))}

            {calc.notes.length > 0 && (
              <>
                <h3 className="mb-1.5 mt-5 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">Notes</h3>
                <ul className="m-0 pl-4 text-body leading-relaxed text-fg">
                  {calc.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            )}
            <h3 className="mb-1.5 mt-5 text-cap font-semibold uppercase tracking-[0.06em] text-muted-fg">References</h3>
            <ol className="m-0 pl-4 text-body leading-relaxed text-fg">
              {calc.references.map((reference) => (
                <li key={reference.citation}>
                  {reference.citation}{" "}
                  {(reference.doi || reference.url) && (
                    <a
                      href={reference.doi ? `https://doi.org/${reference.doi}` : reference.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2"
                    >
                      {reference.doi ? `doi:${reference.doi}` : "source"} <ExternalLink size={10} aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ol>
            <p className="m-0 mt-4 text-cap leading-relaxed text-muted-fg">
              For research and education. Not a medical device; do not use for individual clinical decisions. Reference ranges are laboratory-specific.
            </p>
          </div>
        </PaneBody>
      </Pane>
      <ApplyPanel calc={calc} />
    </>
  );
}

/** Right pane: bring the calculator to the active dataset. */
function ApplyPanel({ calc }: { calc: Calculator }) {
  const navigate = useNavigate();
  const { datasetId, summary } = useActiveDataset();
  const { frame } = useFrame(datasetId);
  return (
    <Pane w={360} side="l">
      <PaneHeader label="Use with data" />
      {frame ? (
        <MappingForm key={`${calc.key}:${frame.datasetId}:${frame.contentHash}`} calc={calc} frame={frame} />
      ) : (
        <PaneBody>
          <EmptyState
            title={summary ? "Loading dataset…" : "No active dataset"}
            hint="Load a dataset to apply this calculator to every row."
            action={
              !summary ? (
                <button type="button" className={pillBtn} onClick={() => navigate("/")}>
                  Go to Overview
                </button>
              ) : undefined
            }
          />
        </PaneBody>
      )}
    </Pane>
  );
}

function MappingForm({ calc, frame }: { calc: Calculator; frame: Frame }) {
  const navigate = useNavigate();
  const [mapping, setMapping] = useState<Record<string, InputMapping>>(() => guessMapping(calc, frame));
  const [outputKey, setOutputKey] = useState(calc.outputs[0].key);
  const [deriving, setDeriving] = useState(false);
  const output = calc.outputs.find((entry) => entry.key === outputKey) ?? calc.outputs[0];
  const mapped = useMemo(() => mappedExpression(calc, outputKey, mapping, frame), [calc, outputKey, mapping, frame]);
  const detail = useQuery({ queryKey: ["wb-dataset", frame.datasetId], queryFn: () => wbApi.getDataset(frame.datasetId), enabled: deriving });

  const preview = useMemo(() => {
    if (!mapped.expr) return null;
    const columns = new Map(frame.columns.map((column) => [column.name, column.values]));
    const values = evaluateColumn(mapped.expr, (name) => columns.get(name), frame.rowCount);
    const numbers = values.filter((value): value is number => typeof value === "number");
    return {
      missing: values.length - numbers.length,
      mean: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null,
      min: numbers.length ? numbers.reduce((a, b) => (b < a ? b : a)) : null,
      max: numbers.length ? numbers.reduce((a, b) => (b > a ? b : a)) : null,
    };
  }, [mapped.expr, frame]);

  const usable = frame.columns.filter((column) => column.error === null && column.role !== "id");
  const needed = new Set(calc.inputs.map((input) => input.name));

  return (
    <PaneBody>
      <Section title="Map inputs to columns">
        <div className="flex flex-col gap-2">
          {calc.inputs.filter((input) => needed.has(input.name)).map((input) => {
            const entry = mapping[input.name] ?? { column: null, unit: 0, yesValue: null };
            const column = frame.columns.find((candidate) => candidate.name === entry.column);
            const options = usable.filter((candidate) => (input.kind === "number" ? candidate.kind === "numeric" : true));
            const update = (patch: Partial<InputMapping>) => setMapping((current) => ({ ...current, [input.name]: { ...entry, ...patch } }));
            return (
              <div key={input.name} className="rounded-md border border-border-2 bg-card-2 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-label font-medium text-fg">{input.label}</span>
                  {input.unit && <span className="ui-mono flex-none text-fine text-muted-fg">{input.unit}</span>}
                </div>
                <div className="mt-1 flex gap-1.5">
                  <select
                    aria-label={`Column for ${input.label}`}
                    className={`${selectSmCls} min-w-0 flex-1`}
                    value={entry.column ?? ""}
                    onChange={(event) => {
                      const name = event.target.value || null;
                      const next = frame.columns.find((candidate) => candidate.name === name);
                      update({
                        column: name,
                        // A hand-picked column gets the same unit detection as the automatic match.
                        unit: next && input.kind === "number" ? guessUnit(input, next) : 0,
                        yesValue:
                          next && next.kind === "categorical"
                            ? guessYesValue(input, next)
                            : next && input.kind === "boolean" && next.kind === "numeric"
                              ? "1"
                              : null,
                      });
                    }}
                  >
                    <option value="">— not mapped —</option>
                    {options.map((candidate) => (
                      <option key={candidate.name} value={candidate.name}>
                        {candidate.name}
                        {candidate.unit ? ` (${candidate.unit})` : ""}
                      </option>
                    ))}
                  </select>
                  {input.kind === "number" && input.units && input.units.length > 1 && column && (
                    <select aria-label={`Unit of ${column.name}`} className={`${selectSmCls} w-[92px] flex-none`} value={entry.unit} onChange={(event) => update({ unit: Number(event.target.value) })}>
                      {input.units.map((unit, index) => (
                        <option key={unit.label} value={index}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {input.kind === "boolean" && column?.kind === "numeric" && isZeroOne(column) && (
                    <select aria-label={`Code meaning yes for ${input.label}`} className={`${selectSmCls} w-[92px] flex-none`} value={entry.yesValue ?? "1"} onChange={(event) => update({ yesValue: event.target.value })}>
                      <option value="1">yes = 1</option>
                      <option value="0">yes = 0</option>
                    </select>
                  )}
                  {input.kind === "boolean" && column?.kind === "categorical" && (
                    <select aria-label={`Value meaning yes for ${input.label}`} className={`${selectSmCls} w-[92px] flex-none`} value={entry.yesValue ?? ""} onChange={(event) => update({ yesValue: event.target.value || null })}>
                      <option value="">yes = …</option>
                      {distinctValues(column, 50).map((level) => (
                        <option key={level} value={level}>
                          yes = {level}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {calc.outputs.length > 1 && (
        <Section title="Output">
          <select aria-label="Calculator output" className={`${selectSmCls} h-7 w-full`} value={outputKey} onChange={(event) => setOutputKey(event.target.value)}>
            {calc.outputs.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </Section>
      )}
      <Section title="Result over the dataset">
        {mapped.expr ? (
          <>
            <p className="ui-mono m-0 break-all text-label text-fg">= {printExpr(mapped.expr)}</p>
            {preview && (
              <div className="ui-mono mt-1.5 text-label text-muted-fg">
                {preview.missing.toLocaleString("en-US")} missing of {frame.rowCount.toLocaleString("en-US")} · mean {fmt(preview.mean)} · range {fmt(preview.min)}–{fmt(preview.max)}
              </div>
            )}
          </>
        ) : (
          <Callout tone="info">{mapped.problems[0]}</Callout>
        )}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className={`${primaryBtn} flex items-center gap-1`} disabled={!mapped.expr} onClick={() => setDeriving(true)}>
            <TableProperties size={13} aria-hidden /> Add as derived variable
          </button>
          <button
            type="button"
            className={`${pillBtn} flex items-center gap-1`}
            disabled={!mapped.expr}
            onClick={() => navigate("/forge", { state: { expr: mapped.expr, title: `${calc.short}${calc.outputs.length > 1 ? ` · ${output.label}` : ""}`, calculatorKey: calc.key } })}
          >
            <Puzzle size={13} aria-hidden /> Open as puzzle
          </button>
        </div>
      </Section>
      {deriving && mapped.expr && detail.data && (
        <DerivedDialog
          frame={frame}
          derived={detail.data.derived}
          editing={null}
          initialExpr={mapped.expr}
          initialName={`${calc.key}${calc.outputs.length > 1 ? `_${output.key}` : ""}`.slice(0, 60)}
          onClose={() => setDeriving(false)}
        />
      )}
      <div className="px-[11px] py-2 text-cap leading-relaxed text-muted-fg">
        The formula is stored with the dataset, so the variable recomputes if the data change and stays auditable.
      </div>
    </PaneBody>
  );
}
