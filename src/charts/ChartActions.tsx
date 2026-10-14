import type { RefObject } from "react";
import { ghostBtn, toast } from "../shared-console/src";
import { downloadPng, downloadSvg } from "./exportSvg";

/** Export buttons for a chart's header slot. Pass the ref you forwarded to the chart. */
export function ChartActions({
  svgRef,
  filename,
  scale = 2,
}: {
  svgRef: RefObject<SVGSVGElement>;
  /** Base filename; the extension is added. */
  filename: string;
  /** PNG pixel ratio. */
  scale?: number;
}) {
  return (
    <>
      <button
        type="button"
        className={`${ghostBtn} cursor-pointer`}
        title="Download SVG"
        onClick={() => svgRef.current && downloadSvg(svgRef.current, filename)}
      >
        SVG
      </button>
      <button
        type="button"
        className={`${ghostBtn} cursor-pointer`}
        title="Download PNG"
        onClick={() => {
          if (svgRef.current) void downloadPng(svgRef.current, filename, scale).catch(() => toast("PNG export failed"));
        }}
      >
        PNG
      </button>
    </>
  );
}
