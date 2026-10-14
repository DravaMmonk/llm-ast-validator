/**
 * Blockly definitions for the workbench puzzle pieces.
 *
 * With the zelos renderer the connector *shape* follows the check type:
 * yes/no pieces are hexagons, numbers are rounded, text is square. So a piece
 * of the wrong kind visibly cannot fit — a criterion slot takes only a
 * hexagon. Every definition here maps one-to-one onto `wbAdapter`.
 */

import * as Blockly from "blockly/core";
import * as En from "blockly/msg/en";

import type { ValueType } from "../../shared/workbench/expr";
import { ARITH_OPS, BLOCK, CHECK, COMPARE_OPS, EQUALS_OPS, FN1_OPS, FN2_OPS, LOGIC_OPS } from "./wbAdapter";

/** Hues per piece family; the library rail mirrors them as dots. */
export const HUE = {
  colNumber: 210,
  colText: 175,
  colBoolean: 45,
  colUnknown: 0,
  number: 140,
  text: 160,
  boolean: 45,
  arith: 265,
  fn: 290,
  compare: 20,
  logic: 45,
  condition: 330,
  missing: 200,
  start: 85,
  include: 135,
  exclude: 355,
} as const;

/** CSS colour for a Blockly hue, matching Blockly's default saturation/value. */
export function hueColor(hue: number): string {
  return Blockly.utils.colour.hueToHex(hue);
}

export function columnHue(type: ValueType | null | undefined): number {
  if (type === "number") return HUE.colNumber;
  if (type === "text") return HUE.colText;
  if (type === "boolean") return HUE.colBoolean;
  return HUE.colUnknown;
}

/** Live column metadata for tooltips; set by the editor that owns the canvas. */
let describeColumn: (name: string) => string = (name) => name;
export function setColumnDescriber(fn: (name: string) => string): void {
  describeColumn = fn;
}

type ColumnBlock = Blockly.Block & { colName: string; valueType: ValueType | null };

const dropdown = (table: [string, string][]) => new Blockly.FieldDropdown(table.map(([label, value]) => [label, value]));

let registered = false;

export function ensureWorkbenchBlocks(): void {
  if (registered) return;
  registered = true;
  // blockly/core ships without UI strings; without them the context menu
  // (Disable, Duplicate, Delete, Comment) throws when it renders.
  Blockly.setLocale(En as unknown as Record<string, string>);

  // Only cohort steps have an "off" state; a disabled piece inside a formula
  // would look switched off yet still be evaluated, so hide the item there.
  const disableItem = Blockly.ContextMenuRegistry.registry.getItem("blockDisable");
  const basePrecondition = disableItem?.preconditionFn;
  if (disableItem && basePrecondition) {
    disableItem.preconditionFn = (scope) =>
      scope.block?.type.startsWith("wb_") && scope.block.type !== BLOCK.step ? "hidden" : basePrecondition(scope);
  }

  const define = (type: string, init: (this: Blockly.Block) => void, extra: Record<string, unknown> = {}) => {
    Blockly.Blocks[type] = { init, ...extra };
  };

  define(BLOCK.num, function () {
    // No bounds: the kernel accepts any finite number (e.g. platelets per litre, 2.5e11).
    this.appendDummyInput().appendField(new Blockly.FieldNumber(0), "VALUE");
    this.setOutput(true, CHECK.number);
    this.setColour(HUE.number);
    this.setTooltip("A number, e.g. a weight or a threshold.");
  });

  define(BLOCK.text, function () {
    this.appendDummyInput().appendField("“").appendField(new Blockly.FieldTextInput("value"), "VALUE").appendField("”");
    this.setOutput(true, CHECK.text);
    this.setColour(HUE.text);
    this.setTooltip("A text value, e.g. a category such as F or current.");
  });

  define(BLOCK.bool, function () {
    this.appendDummyInput().appendField(
      dropdown([
        ["yes", "TRUE"],
        ["no", "FALSE"],
      ]),
      "VALUE",
    );
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.boolean);
    this.setTooltip("A yes/no value.");
  });

  define(
    BLOCK.col,
    function (this: Blockly.Block) {
      const self = this as ColumnBlock;
      self.colName = "";
      self.valueType = null;
      this.appendDummyInput("MAIN").appendField(new Blockly.FieldLabelSerializable("column"), "NAME");
      this.setOutput(true, null);
      this.setColour(HUE.colUnknown);
    },
    {
      saveExtraState(this: ColumnBlock) {
        return { name: this.colName, valueType: this.valueType };
      },
      loadExtraState(this: ColumnBlock, state: { name?: string; valueType?: ValueType | null }) {
        this.colName = state.name ?? "";
        this.valueType = state.valueType ?? null;
        this.setFieldValue(this.colName || "column", "NAME");
        this.setOutput(true, this.valueType ? CHECK[this.valueType] : null);
        this.setColour(columnHue(this.valueType));
        this.setTooltip(
          this.valueType
            ? describeColumn(this.colName)
            : `“${this.colName}” is not a column of the current dataset.`,
        );
      },
    },
  );

  define(BLOCK.arith, function () {
    this.appendValueInput("A").setCheck(CHECK.number);
    this.appendValueInput("B").setCheck(CHECK.number).appendField(dropdown(ARITH_OPS.map(([l, v]) => [l, v])), "OP");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.number);
    this.setColour(HUE.arith);
    this.setTooltip("Arithmetic: + − × ÷ and power. Division by zero gives a missing value.");
  });

  define(BLOCK.fn1, function () {
    this.appendValueInput("X").setCheck(CHECK.number).appendField(dropdown(FN1_OPS.map(([l, v]) => [l, v])), "OP");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.number);
    this.setColour(HUE.fn);
    this.setTooltip("A function of one number. Undefined results (√ of a negative, ln of 0) are missing.");
  });

  define(BLOCK.fn2, function () {
    this.appendValueInput("A").setCheck(CHECK.number).appendField(dropdown(FN2_OPS.map(([l, v]) => [l, v])), "OP");
    this.appendValueInput("B").setCheck(CHECK.number).appendField(",");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.number);
    this.setColour(HUE.fn);
    this.setTooltip("min / max of two numbers, or round(value, digits).");
  });

  define(BLOCK.clamp, function () {
    this.appendValueInput("X").setCheck(CHECK.number).appendField("clamp");
    this.appendValueInput("LO").setCheck(CHECK.number).appendField("to");
    this.appendValueInput("HI").setCheck(CHECK.number).appendField("…");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.number);
    this.setColour(HUE.fn);
    this.setTooltip("Limits a value to the range [low, high].");
  });

  define(BLOCK.compare, function () {
    this.appendValueInput("A").setCheck(CHECK.number);
    this.appendValueInput("B").setCheck(CHECK.number).appendField(dropdown(COMPARE_OPS.map(([l, v]) => [l, v])), "OP");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.compare);
    this.setTooltip("Compares two numbers. Missing if either side is missing.");
  });

  define(BLOCK.equals, function () {
    this.appendValueInput("A").setCheck([CHECK.text, CHECK.boolean]);
    this.appendValueInput("B")
      .setCheck([CHECK.text, CHECK.boolean])
      .appendField(dropdown(EQUALS_OPS.map(([l, v]) => [l, v])), "OP");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.compare);
    this.setTooltip("Tests whether a text or yes/no value equals another.");
  });

  define(BLOCK.between, function () {
    this.appendValueInput("X").setCheck(CHECK.number);
    this.appendValueInput("LO").setCheck(CHECK.number).appendField("between");
    this.appendValueInput("HI").setCheck(CHECK.number).appendField("and");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.compare);
    this.setTooltip("Inclusive range check: low ≤ value ≤ high.");
  });

  define(BLOCK.oneOf, function () {
    this.appendValueInput("X").setCheck(CHECK.text);
    this.appendDummyInput().appendField("is one of").appendField(new Blockly.FieldTextInput("a, b", (text: string) => text.slice(0, 400)), "LIST");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.compare);
    this.setTooltip("True when the text equals any comma-separated entry.");
  });

  define(BLOCK.logic, function () {
    this.appendValueInput("A").setCheck(CHECK.boolean);
    this.appendValueInput("B").setCheck(CHECK.boolean).appendField(dropdown(LOGIC_OPS.map(([l, v]) => [l, v])), "OP");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.logic);
    this.setTooltip("Combines conditions. “false and unknown” is false; “true or unknown” is true.");
  });

  define(BLOCK.not, function () {
    this.appendValueInput("X").setCheck(CHECK.boolean).appendField("not");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.logic);
    this.setTooltip("Negates a condition.");
  });

  define(BLOCK.if, function () {
    this.appendValueInput("COND").setCheck(CHECK.boolean).appendField("if");
    this.appendValueInput("THEN").appendField("then");
    this.appendValueInput("ELSE").appendField("else");
    this.setInputsInline(true);
    this.setOutput(true, null);
    this.setColour(HUE.condition);
    this.setTooltip("Chooses between two values. Both branches must be the same kind. Points-based scores add up if pieces.");
  });

  define(BLOCK.missing, function () {
    this.appendValueInput("X").appendField("missing");
    this.setInputsInline(true);
    this.setOutput(true, CHECK.boolean);
    this.setColour(HUE.missing);
    this.setTooltip("Yes when the value is missing.");
  });

  define(BLOCK.coalesce, function () {
    this.appendValueInput("A");
    this.appendValueInput("B").appendField("or if missing");
    this.setInputsInline(true);
    this.setOutput(true, null);
    this.setColour(HUE.missing);
    this.setTooltip("Uses the first value, or the second when the first is missing.");
  });

  define(BLOCK.validIf, function () {
    this.appendValueInput("X").appendField("keep");
    this.appendValueInput("COND").setCheck(CHECK.boolean).appendField("only if");
    this.setInputsInline(true);
    this.setOutput(true, null);
    this.setColour(HUE.missing);
    this.setTooltip("The value where the condition holds, missing elsewhere — e.g. a formula outside its validity range.");
  });

  define(BLOCK.cohortStart, function () {
    this.appendDummyInput().appendField("▶ start with").appendField(new Blockly.FieldLabelSerializable("all rows"), "LABEL");
    this.setNextStatement(true, "Step");
    this.setColour(HUE.start);
    this.setDeletable(false);
    this.setTooltip("Every criterion below is applied in order to the rows that are still in the cohort.");
    (this as Blockly.Block & { hat?: string }).hat = "cap";
  });

  define(
    BLOCK.step,
    function (this: Blockly.Block) {
      const kind = new Blockly.FieldDropdown(
        [
          ["include", "include"],
          ["exclude", "exclude"],
        ],
        (value: string) => {
          this.setColour(value === "exclude" ? HUE.exclude : HUE.include);
          return value;
        },
      );
      this.appendValueInput("COND").setCheck(CHECK.boolean).appendField(kind, "KIND").appendField("rows where");
      this.appendDummyInput()
        .appendField("label")
        .appendField(new Blockly.FieldTextInput("", (text: string) => text.slice(0, 200)), "LABEL")
        .appendField("· if unknown")
        .appendField(
          new Blockly.FieldDropdown([
            ["drop row", "drop"],
            ["keep row", "keep"],
          ]),
          "MISSING",
        );
      this.setPreviousStatement(true, "Step");
      this.setNextStatement(true, "Step");
      // Two rows: the condition, then its label and missing-data policy.
      this.setInputsInline(false);
      this.setColour(HUE.include);
      this.setTooltip(
        "Include keeps rows where the condition is yes; exclude removes them. Right-click → Disable to switch a step off without deleting it.",
      );
    },
    {
      saveExtraState(this: Blockly.Block & { stepId?: string }) {
        return { stepId: this.stepId ?? "" };
      },
      loadExtraState(this: Blockly.Block & { stepId?: string }, state: { stepId?: string }) {
        this.stepId = state.stepId ?? "";
      },
    },
  );
}
