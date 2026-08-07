// Motion is additive: the CSS already renders the finished state, so no-motion
// visitors get the same page without the assembly. Ported near-verbatim from the
// pre-React inline script — it is plain DOM work over an already-painted tree,
// and rewriting it into render state would buy nothing.

export const motionOK = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const onScreen = (el: Element, run: (el: Element) => void) =>
  new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries)
        if (e.isIntersecting) {
          obs.unobserve(e.target);
          run(e.target);
        }
    },
    { threshold: 0.35 },
  ).observe(el);

/** Wires the scroll-triggered animations. Returns a teardown. */
export function runMotion(root: HTMLElement): () => void {
  if (!motionOK) return () => {};
  let cancelled = false;

  const tape = root.querySelector("[data-animate]");
  if (tape) onScreen(tape, (el) => el.classList.add("play"));

  // The install terminal types its command, then drops each output line as the
  // step it belongs to lights up. Steps and lines are paired by data-step/data-out.
  const term = root.querySelector("[data-term]");
  if (term) {
    const typed = term.querySelector("[data-type]")!;
    const command = typed.textContent ?? "";
    const lines = [...term.querySelectorAll("[data-out]")];
    const steps = [...root.querySelectorAll<HTMLElement>(".step")];
    const light = (n: number) =>
      steps.forEach((s) => s.classList.toggle("is-on", s.dataset.step === String(n)));

    typed.textContent = "";
    term.classList.add("armed");
    lines.forEach((l) => l.classList.add("pending"));

    onScreen(term, async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      light(2);
      for (const ch of command) {
        if (cancelled) return;
        typed.textContent += ch;
        await wait(28);
      }
      await wait(320);
      if (cancelled) return;
      term.classList.remove("armed"); // caret stops blinking, output begins
      for (const line of lines) {
        if (cancelled) return;
        light(Number((line as HTMLElement).dataset.out));
        line.classList.remove("pending");
        await wait(420);
      }
      // Ends on the last step rather than clearing, so the finished state is the
      // same one a no-motion visitor sees plus the step the sequence landed on.
    });
  }

  return () => {
    cancelled = true;
  };
}
