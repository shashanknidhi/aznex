// In-memory hook queue (#16). Hooks must return instantly, so enqueue is
// synchronous and processing happens in a single async drain loop.
// ponytail: in-memory only — payloads in flight are lost on crash; add disk
// journaling if that ever matters (hooks fire constantly, losses are cheap).

export type HookPayload = Record<string, unknown>;

export class HookQueue {
  private items: HookPayload[] = [];
  private draining = false;
  private idleResolvers: (() => void)[] = [];

  constructor(private process: (payload: HookPayload) => Promise<void>) {}

  enqueue(payload: HookPayload): void {
    this.items.push(payload);
    void this.drain();
  }

  get size(): number {
    return this.items.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let payload: HookPayload | undefined;
      while ((payload = this.items.shift()) !== undefined) {
        try {
          await this.process(payload);
        } catch (err) {
          console.error("pipeline error (payload dropped):", err);
        }
      }
    } finally {
      this.draining = false;
      for (const resolve of this.idleResolvers.splice(0)) resolve();
    }
  }

  /** Resolves once the queue is empty and processing has stopped. */
  flush(): Promise<void> {
    if (!this.draining && this.items.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }
}
