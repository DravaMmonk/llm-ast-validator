/**
 * One FIFO in-process runner (plan Section 5).
 *
 * Generation concurrency is 1 and evaluation concurrency is 1, on separate
 * lanes so a long evaluation cannot starve generation. There is no external
 * queue: run state lives in SQLite, and the API inserts the run row before work
 * starts, so a crash leaves a visible `pending`/`running` row that startup
 * recovery converts into a retryable failure.
 */

export type Lane = "generation" | "evaluation";

export interface RunnerOptions {
  onError?: (lane: Lane, error: unknown) => void;
}

interface LaneState {
  queue: (() => Promise<void>)[];
  active: boolean;
  idleWaiters: (() => void)[];
}

export class InProcessRunner {
  private readonly lanes: Record<Lane, LaneState> = {
    generation: { queue: [], active: false, idleWaiters: [] },
    evaluation: { queue: [], active: false, idleWaiters: [] },
  };

  constructor(private readonly options: RunnerOptions = {}) {}

  /**
   * Enqueues work and returns before any of it runs.
   *
   * The drain is deferred to a microtask on purpose: calling an async function
   * executes its body synchronously up to the first `await`, which would run the
   * task's synchronous prefix inside `enqueue` and delay the 202 the API owes
   * the caller.
   */
  enqueue(lane: Lane, task: () => Promise<void>): void {
    this.lanes[lane].queue.push(task);
    queueMicrotask(() => void this.drain(lane));
  }

  private async drain(lane: Lane): Promise<void> {
    const state = this.lanes[lane];
    if (state.active) return;
    state.active = true;

    try {
      while (state.queue.length > 0) {
        const task = state.queue.shift()!;
        try {
          await task();
        } catch (error) {
          // A failed task must not stop the lane; the run row records the failure.
          this.options.onError?.(lane, error);
        }
      }
    } finally {
      state.active = false;
      const waiters = state.idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  /** Resolves once the lane has drained. Test and shutdown support. */
  async whenIdle(lane: Lane): Promise<void> {
    const state = this.lanes[lane];
    if (!state.active && state.queue.length === 0) return;
    await new Promise<void>((resolve) => state.idleWaiters.push(resolve));
  }

  async whenAllIdle(): Promise<void> {
    await Promise.all([this.whenIdle("generation"), this.whenIdle("evaluation")]);
  }

  depth(lane: Lane): number {
    return this.lanes[lane].queue.length + (this.lanes[lane].active ? 1 : 0);
  }
}
