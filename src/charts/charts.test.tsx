import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AttritionFlow,
  BarChart,
  BoxPlot,
  ChartActions,
  FaganNomogram,
  ForestPlot,
  Heatmap,
  Histogram,
  IconArray,
  Legend,
  LineChart,
  NumberAtRiskTable,
  ScatterPlot,
  downsample,
  jitter,
  stepPoints,
  valueAt,
} from "./index";

/** No NaN / Infinity may leak into any SVG attribute. */
function expectCleanSvg(container: HTMLElement) {
  for (const el of Array.from(container.querySelectorAll("svg, svg *"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.value, `${el.tagName}[${attr.name}]`).not.toMatch(/NaN|Infinity|undefined/);
    }
  }
}
const marks = (c: HTMLElement, kind: string) => c.querySelectorAll(`[data-mark="${kind}"]`);

describe("Histogram", () => {
  const bins = Array.from({ length: 12 }, (_, i) => ({ x0: i * 5, x1: i * 5 + 5, count: (i * 7) % 11 }));
  it("renders bars, markers and an accessible name", () => {
    const { container } = render(
      <Histogram title="Age distribution" bins={bins} xLabel="Age" markers={[{ x: 30, label: "mean" }, { x: 32, label: "threshold" }]} />,
    );
    expect(screen.getByRole("img", { name: "Age distribution" })).toBeInTheDocument();
    expect(container.querySelector("title")?.textContent).toBe("Age distribution");
    expect(marks(container, "bar")).toHaveLength(12);
    expect(screen.getByText("threshold")).toBeInTheDocument();
    expectCleanSvg(container);
  });
  it("renders an empty state", () => {
    const { container } = render(<Histogram title="Empty" bins={[]} />);
    expect(screen.getByRole("img", { name: "Empty" })).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
    expectCleanSvg(container);
  });
  it("forwards the svg ref", () => {
    const ref = createRef<SVGSVGElement>();
    render(<Histogram ref={ref} title="Ref" bins={bins} />);
    expect(ref.current?.tagName.toLowerCase()).toBe("svg");
  });
});

describe("BarChart", () => {
  const data = [
    { label: "Type 2 diabetes mellitus without complications (long label)", value: 412 },
    { label: "Hypertension", value: 380, detail: "ICD-10 I10" },
    { label: "CKD stage 3", value: 95 },
  ];
  it("renders horizontal bars with truncated labels and full-label titles", () => {
    const { container } = render(<BarChart title="Diagnoses" data={data} />);
    expect(screen.getByRole("img", { name: "Diagnoses" })).toBeInTheDocument();
    expect(marks(container, "bar")).toHaveLength(3);
    const titles = Array.from(container.querySelectorAll("text > title")).map((t) => t.textContent);
    expect(titles).toContain(data[0].label);
    expectCleanSvg(container);
  });
  it("renders vertical bars, handles negatives", () => {
    const { container } = render(
      <BarChart title="Deltas" orientation="vertical" data={[{ label: "a", value: -3 }, { label: "b", value: 5 }]} yLabel="Δ" />,
    );
    expect(marks(container, "bar")).toHaveLength(2);
    expectCleanSvg(container);
  });
  it("shows a tooltip on focus and an empty state", () => {
    const { container, unmount } = render(<BarChart title="Diagnoses" data={data} />);
    fireEvent.focus(marks(container, "bar")[1]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("ICD-10 I10");
    unmount();
    render(<BarChart title="Nothing" data={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("BoxPlot", () => {
  it("renders one box per group with jittered points", () => {
    const points = Array.from({ length: 40 }, (_, i) => 5 + (i % 9));
    const { container } = render(
      <BoxPlot
        title="HbA1c by arm"
        yLabel="HbA1c %"
        groups={[
          { label: "Control", stats: { min: 5, q1: 6, median: 7, q3: 8, max: 10 }, outliers: [12.5], points },
          { label: "Treatment", stats: { min: 4.5, q1: 5.5, median: 6.2, q3: 7, max: 9 } },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "HbA1c by arm" })).toBeInTheDocument();
    expect(marks(container, "box")).toHaveLength(2);
    expect(container.querySelectorAll("circle").length).toBeGreaterThanOrEqual(41);
    expectCleanSvg(container);
  });
  it("jitter is deterministic and bounded", () => {
    expect(jitter(3)).toBe(jitter(3));
    for (let i = 0; i < 100; i++) expect(Math.abs(jitter(i))).toBeLessThanOrEqual(0.5);
  });
  it("renders empty state", () => {
    render(<BoxPlot title="None" groups={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("ScatterPlot", () => {
  it("colors groups, shows legend, downsamples deterministically", () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({ x: i % 100, y: (i * 37) % 91, group: i % 2 ? "Female" : "Male" }));
    const { container } = render(
      <ScatterPlot title="BMI vs SBP" points={points} xLabel="BMI" yLabel="SBP" fitLine={{ slope: 0.5, intercept: 10 }} maxPoints={1000} />,
    );
    expect(screen.getByRole("img", { name: "BMI vs SBP" })).toBeInTheDocument();
    expect(marks(container, "point")).toHaveLength(1000);
    expect(screen.getByText("Female")).toBeInTheDocument();
    expect(screen.getByText(/showing/)).toHaveTextContent("1,000");
    expectCleanSvg(container);
    expect(downsample([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
  });
  it("renders empty state", () => {
    render(<ScatterPlot title="None" points={[]} xLabel="x" yLabel="y" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("LineChart", () => {
  const km = {
    label: "Treated",
    step: true,
    points: [
      { x: 0, y: 1 },
      { x: 2, y: 0.9 },
      { x: 5, y: 0.75 },
      { x: 9, y: 0.6 },
    ],
    band: [
      { x: 0, lower: 1, upper: 1 },
      { x: 2, lower: 0.82, upper: 0.96 },
      { x: 5, lower: 0.65, upper: 0.84 },
      { x: 9, lower: 0.48, upper: 0.71 },
    ],
    marks: [{ x: 3, y: 0.9 }],
  };
  it("renders KM step series with band, censor marks and legend", () => {
    const { container } = render(
      <LineChart
        title="Survival"
        series={[km, { label: "Control", step: true, dashed: true, points: [{ x: 0, y: 1 }, { x: 4, y: 0.7 }, { x: 9, y: 0.4 }] }]}
        xLabel="Months"
        yLabel="Survival"
        yDomain={[0, 1]}
        hLines={[{ y: 0.5, label: "median" }]}
      />,
    );
    expect(screen.getByRole("img", { name: "Survival" })).toBeInTheDocument();
    expect(marks(container, "series")).toHaveLength(2);
    expect(screen.getByText("Control")).toBeInTheDocument();
    expectCleanSvg(container);
  });
  it("renders ROC with diagonal and highlight; keyboard crosshair reports x", () => {
    const onHoverX = vi.fn();
    const { container } = render(
      <LineChart
        title="ROC"
        series={[{ label: "Model", points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.6 }, { x: 0.3, y: 0.85 }, { x: 1, y: 1 }] }]}
        xLabel="1 − specificity"
        yLabel="Sensitivity"
        xDomain={[0, 1]}
        yDomain={[0, 1]}
        diagonal
        highlight={{ x: 0.1, y: 0.6, label: "cut-off 0.42" }}
        onHoverX={onHoverX}
      />,
    );
    expect(marks(container, "highlight")).toHaveLength(1);
    const svg = screen.getByRole("img", { name: "ROC" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(onHoverX).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(onHoverX).toHaveBeenLastCalledWith(0.1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("0.6");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(onHoverX).toHaveBeenLastCalledWith(null);
  });
  it("post-step interpolation holds the value until the next x", () => {
    const pts = km.points;
    expect(valueAt(pts, 4.9, (p) => p.y, true)).toBe(0.9);
    expect(valueAt(pts, 5, (p) => p.y, true)).toBe(0.75);
    expect(valueAt(pts, 3.5, (p) => p.y, false)).toBeCloseTo(0.825);
    expect(valueAt(pts, -1, (p) => p.y, true)).toBeNull();
    expect(stepPoints(pts.slice(0, 2), (p) => p.y)).toEqual([
      [0, 1],
      [2, 1],
      [2, 0.9],
    ]);
  });
  it("renders empty state", () => {
    render(<LineChart title="None" series={[]} xLabel="x" yLabel="y" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("Heatmap", () => {
  const vars = ["Age", "BMI", "SBP"];
  it("renders a cell per value, hatched nulls, click callback", () => {
    const onCellClick = vi.fn();
    const { container } = render(
      <Heatmap
        title="Correlation"
        rows={vars}
        cols={vars}
        values={[
          [1, 0.32, -0.81],
          [0.32, 1, null],
          [-0.81, null, 1],
        ]}
        onCellClick={onCellClick}
      />,
    );
    expect(screen.getByRole("img", { name: "Correlation" })).toBeInTheDocument();
    const cells = marks(container, "cell");
    expect(cells).toHaveLength(9);
    expect(screen.getAllByText(".32").length).toBe(2);
    expect(screen.getByText("missing")).toBeInTheDocument();
    fireEvent.click(cells[2]);
    expect(onCellClick).toHaveBeenCalledWith(0, 2);
    fireEvent.keyDown(cells[3], { key: "Enter" });
    expect(onCellClick).toHaveBeenLastCalledWith(1, 0);
    expectCleanSvg(container);
  });
  it("renders empty state", () => {
    render(<Heatmap title="None" rows={[]} cols={[]} values={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("ForestPlot", () => {
  it("renders rows, detail/p columns and clamps unbounded CIs with arrows", () => {
    const { container } = render(
      <ForestPlot
        title="Hazard ratios"
        xLabel="Hazard ratio"
        rows={[
          { label: "Age ≥ 65", estimate: 1.82, lower: 1.2, upper: 2.75, detail: "1.82 (1.20–2.75)", p: 0.004 },
          { label: "Female", estimate: 0.91, lower: 0.7, upper: 1.18, detail: "0.91 (0.70–1.18)", p: 0.48 },
          { label: "Rare exposure", estimate: 3.1, lower: 0.0001, upper: Infinity, detail: "3.10 (0.00–∞)", p: null },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Hazard ratios" })).toBeInTheDocument();
    expect(marks(container, "forest-row")).toHaveLength(3);
    expect(screen.getByText("1.82 (1.20–2.75)")).toBeInTheDocument();
    expect(screen.getByText("0.004")).toBeInTheDocument();
    expect(container.querySelector('[data-clip="lower"]')).not.toBeNull();
    expect(container.querySelector('[data-clip="upper"]')).not.toBeNull();
    expectCleanSvg(container);
  });
  it("supports linear scale and empty state", () => {
    const { container, unmount } = render(
      <ForestPlot title="Mean differences" log={false} nullValue={0} rows={[{ label: "A", estimate: -0.4, lower: -1, upper: 0.2 }]} />,
    );
    expect(marks(container, "forest-row")).toHaveLength(1);
    expectCleanSvg(container);
    unmount();
    render(<ForestPlot title="None" rows={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("AttritionFlow", () => {
  const steps = [
    { label: "Age ≥ 18 at index date", kind: "include" as const, remaining: 9200, excluded: 800, missing: 120 },
    { label: "Prior myocardial infarction", kind: "exclude" as const, remaining: 8700, excluded: 500 },
    { label: "Disabled criterion", kind: "include" as const, remaining: 8700, excluded: 0, disabled: true },
  ];
  it("shows boxes and numbers", () => {
    const { container } = render(<AttritionFlow title="Cohort attrition" start={{ label: "All patients", n: 10000 }} steps={steps} final={{ label: "Analytic cohort" }} />);
    expect(screen.getByRole("img", { name: "Cohort attrition" })).toBeInTheDocument();
    expect(marks(container, "flow-box")).toHaveLength(5);
    expect(marks(container, "flow-side")).toHaveLength(2);
    expect(screen.getByText("n = 10,000")).toBeInTheDocument();
    expect(screen.getByText("Excluded n = 800")).toBeInTheDocument();
    // Wrapped lines are separate text nodes; compare without whitespace.
    const side = Array.from(marks(container, "flow-side")).map((node) => node.textContent ?? "").join(" ").replace(/\s+/g, "");
    expect(side).toContain("Didnotmeet:Age≥18atindexdate(n=680)");
    expect(side).toContain("missingdata(n=120)");
    expect(side).toContain("Priormyocardialinfarction(n=500)");
    expect(container.textContent).toContain("After excluding: Prior myocardial infarction");
    expect(screen.getAllByText(/skipped · n = 8,700/).length).toBeGreaterThan(0);
    expectCleanSvg(container);
  });
  it("calls onStepClick and marks the active step", () => {
    const onStepClick = vi.fn();
    render(<AttritionFlow title="Flow" start={{ label: "All", n: 100 }} steps={steps} onStepClick={onStepClick} activeStep={1} />);
    const buttons = screen.getAllByRole("button", { hidden: true });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(onStepClick).toHaveBeenCalledWith(0);
    fireEvent.keyDown(buttons[2], { key: "Enter" });
    expect(onStepClick).toHaveBeenLastCalledWith(2);
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
  });
  it("handles 30 steps with long labels and grows in height", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      label: `Criterion ${i} with an exceptionally long descriptive label that must wrap onto several lines, keep going well past three lines, and then finally be ellipsized somewhere near the end`,
      kind: (i % 2 ? "exclude" : "include") as "include" | "exclude",
      remaining: 1000 - i * 10,
      excluded: 10,
      missing: i % 3,
    }));
    const { container } = render(<AttritionFlow title="Long" start={{ label: "All", n: 1000 }} steps={many} />);
    expect(marks(container, "flow-box")).toHaveLength(31);
    const h = Number(screen.getByRole("img", { name: "Long" }).getAttribute("height"));
    expect(h).toBeGreaterThan(31 * 40);
    expect(container.textContent).toContain("…");
    expectCleanSvg(container);
  });
  it("renders with zero steps", () => {
    const { container } = render(<AttritionFlow title="Zero" start={{ label: "All", n: 50 }} steps={[]} />);
    expect(marks(container, "flow-box")).toHaveLength(1);
  });
});

describe("IconArray", () => {
  it("renders total icons with groups first and a legend", () => {
    const { container } = render(
      <IconArray
        title="Risk"
        groups={[
          { count: 12, label: "Event with treatment", color: "var(--chart-1)" },
          { count: 6, label: "Extra events without", color: "var(--chart-2)" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Risk" })).toBeInTheDocument();
    const icons = marks(container, "icon");
    expect(icons).toHaveLength(100);
    expect(screen.getByText(/remaining · 82 of 100/)).toBeInTheDocument();
    expectCleanSvg(container);
  });
  it("renders empty state", () => {
    render(<IconArray title="None" groups={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("FaganNomogram", () => {
  it("computes post-test probability (pre 0.25, LR 4 → 57.1%)", () => {
    const { container } = render(<FaganNomogram title="Fagan" preTest={0.25} lrPositive={4} lrNegative={0.2} />);
    expect(screen.getByRole("img", { name: "Fagan" })).toBeInTheDocument();
    expect(marks(container, "fagan-line")).toHaveLength(2);
    expect(screen.getByTestId("fagan-post-pos")).toHaveTextContent("57.1%");
    expect(screen.getByTestId("fagan-post-neg")).toHaveTextContent("6.3%");
    expectCleanSvg(container);
  });
  it("is a keyboard slider when onPreTestChange is given", () => {
    const onChange = vi.fn();
    render(<FaganNomogram title="Fagan" preTest={0.25} lrPositive={4} onPreTestChange={onChange} />);
    const slider = screen.getByRole("slider", { hidden: true });
    expect(slider).toHaveAttribute("aria-valuenow", "25");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(0.26);
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(0.24);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(0.999);
  });
  it("is not interactive without a callback, and handles missing LRs / empty", () => {
    const { unmount } = render(<FaganNomogram title="Static" preTest={0.1} />);
    expect(screen.queryByRole("slider", { hidden: true })).toBeNull();
    unmount();
    render(<FaganNomogram title="Bad" preTest={NaN} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

describe("NumberAtRiskTable, Legend, ChartActions", () => {
  it("renders counts per group", () => {
    render(
      <NumberAtRiskTable
        times={[0, 6, 12]}
        xDomain={[0, 12]}
        groups={[
          { label: "Treated", counts: [500, 410, 1200] },
          { label: "Control", counts: [498, 380, 300] },
        ]}
      />,
    );
    expect(screen.getByRole("table", { name: "Number at risk" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell")).toHaveLength(6);
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });
  it("renders legend items", () => {
    render(<Legend items={[{ label: "A", color: "var(--chart-1)" }, { label: "B", color: "var(--chart-2)", dashed: true }]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("renders export buttons in a chart header", () => {
    const ref = createRef<SVGSVGElement>();
    render(<Histogram ref={ref} title="H" bins={[{ x0: 0, x1: 1, count: 2 }]} actions={<ChartActions svgRef={ref} filename="h" />} />);
    expect(screen.getByRole("button", { name: "SVG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PNG" })).toBeInTheDocument();
  });
});
