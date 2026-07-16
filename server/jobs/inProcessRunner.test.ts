import { describe, expect, it } from "vitest";

import { InProcessRunner } from "./inProcessRunner";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("InProcessRunner", () => {
  it("runs generation tasks one at a time", async () => {
    const runner = new InProcessRunner();
    let active = 0;
    let peak = 0;
    const order: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      runner.enqueue("generation", async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(i);
        active -= 1;
      });
    }
    await runner.whenIdle("generation");

    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps generation and evaluation on independent lanes", async () => {
    const runner = new InProcessRunner();
    const gate = deferred();
    const done: string[] = [];

    runner.enqueue("generation", async () => {
      await gate.promise;
      done.push("generation");
    });
    runner.enqueue("evaluation", async () => {
      done.push("evaluation");
    });

    // A blocked generation must not starve evaluation.
    await runner.whenIdle("evaluation");
    expect(done).toEqual(["evaluation"]);

    gate.resolve();
    await runner.whenIdle("generation");
    expect(done).toEqual(["evaluation", "generation"]);
  });

  it("continues the lane after a task throws and reports the error", async () => {
    const errors: unknown[] = [];
    const runner = new InProcessRunner({ onError: (_lane, error) => errors.push(error) });
    const done: string[] = [];

    runner.enqueue("generation", async () => {
      throw new Error("task exploded");
    });
    runner.enqueue("generation", async () => {
      done.push("second");
    });
    await runner.whenIdle("generation");

    expect(errors).toHaveLength(1);
    expect(done).toEqual(["second"]);
  });

  it("returns immediately from enqueue", () => {
    const runner = new InProcessRunner();
    let started = false;
    runner.enqueue("generation", async () => {
      started = true;
    });
    // The API responds 202 before the work runs.
    expect(started).toBe(false);
    expect(runner.depth("generation")).toBeGreaterThan(0);
  });

  it("resolves whenIdle immediately for an empty lane", async () => {
    await expect(new InProcessRunner().whenIdle("generation")).resolves.toBeUndefined();
  });

  it("drains work enqueued while the lane is already running", async () => {
    const runner = new InProcessRunner();
    const done: string[] = [];

    runner.enqueue("generation", async () => {
      done.push("first");
      runner.enqueue("generation", async () => {
        done.push("nested");
      });
    });
    await runner.whenIdle("generation");

    expect(done).toEqual(["first", "nested"]);
  });
});
