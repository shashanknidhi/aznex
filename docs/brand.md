# Brand and positioning

Approved 2026-08-05. The visual half of this is implemented in
`packages/landing/`; treat that directory as the reference rendering.


## Why this exists

Aznex had a product and a landing page but no stated position. Without one, every
new surface — the app, the CLI, outreach copy, the next page — invents its own,
and the thing reads as four products. This document fixes the position, the
words, and the visual system so the next surface can be built without relitigating
any of it.

It also resolves a live contradiction: pilot outreach on X pitched a solo pain
("your agent forgets between sessions") while the product is built team-first
(org gates, collaborator checks, shared-the-moment-it-lands). The team story wins.

---

## Positioning

**Aznex is the shared context layer for engineering teams and their coding agents.**

The wedge: context today is per-person and per-session. Every agent starts from
zero, re-derives what someone already worked out, and walks into a dead end that
the person at the next desk mapped last Tuesday. The knowledge exists — it is
stranded on four laptops in four vendors.

**Audience, in order:** the team, from day one. Not the solo developer (that
framing invites comparison to personal-memory tools and hides what is actually
hard to copy), and not the eng lead as first contact (adoption still has to come
from developers).

**Category:** *shared context layer*, not *memory*. Memory is crowded — mem0,
supermemory, Letta, claude-mem — and backward-looking. Context layer is
uncontested and forward-looking, which is what the MCP read side actually does:
it answers what the agent needs right now.

## The name

"Aznex" means nothing and is never explained. No etymology, no About-page
backstory, no grafted "nexus" story. A meaningless name is a blank container for
a category we are trying to own; the explaining budget goes to "shared context
layer" instead.

## Pillars

Three, each traceable to shipped code. Every claim on every surface must ladder
to one of these.

1. **Shared by default** — repo-scoped, org-gated, visible to every member the
   moment it lands. Not a personal notebook with an export button.
   *Proof:* `auth/authorize.ts` double gate; no promotion or staleness state.
2. **Local by construction** — extraction runs on the developer's machine on
   their own subscription. Raw tool output never crosses the wire. Privacy is
   the architecture, not a setting.
   *Proof:* worker spawns the local CLI; two-pass secret scrubbing.
3. **Any agent reads it** — one MCP endpoint. Capture needs a thin per-agent
   hook; reads need nothing.
   *Proof:* MCP routes; Claude Code and Codex hook adapters.

## Voice

Plain infrastructure. Declarative, specific, mechanism over benefit. State what
happens and trust the reader to draw the conclusion.

- "Extraction runs on your machine, on the subscription you already pay for."
- "Membership in the repo's org and a live collaborator check, on every request."

Not: "supercharge", "unlock", "seamless", "effortless", "AI-powered",
"knowledge base", "second brain".

**Lexicon.** The layer is **context**; the unit is a **memory**. Keeping those
distinct is what stops the brand sliding back into the memory lane — we sell the
layer, we store memories. Say *repo, agent, session, collaborator, the team's
context*.

**Headline.** `Your agent forgets. Your team shouldn't.` The subline carries the
position explicitly: *Aznex is the shared context layer for your repo. One
developer's agent works something out; every teammate's agent starts from there.*

---

## Visual system

### Mark

Three uneven grey traces resolving into one solid ochre block — raw tool calls
converging into one remembered unit. It is the product's sentence, drawn, and the
same thing the hero animation acts out. Legible at 16px. Shipped as
`packages/landing/favicon.svg`.

Wordmark: `aznex`, lowercase, Bricolage Grotesque 700, tracking −4.5%.

### Palette

| Token | Dark | Light | Means |
|---|---|---|---|
| ink | `#0B0E14` | `#F4F6F9` | ground (never `#000`) |
| slate | `#141A24` | `#FFFFFF` | raised surface |
| rule | `#3D4C62` | `#A6B1C2` | hairline |
| bone | `#E6E9EF` | `#131A24` | primary text |
| mute | `#9AA7BD` | `#475162` | secondary text — **and** raw, local, not yet shared |
| ochre | `#E0A458` | `#734506` | the one accent — **shared context, crossed the wire** |

**Every text pair clears WCAG AAA (7:1) against both grounds** — that is the
floor, not the goal, and it is why the two ochres are so far apart: the mid-tone
that reads right on ink lands at 4.1 on paper, which fails even AA, including
the copy-button label. Changing `--mute` or `--ochre` means re-checking against
both `--ink` and `--slate` in the theme you touched.

**Ochre is never decorative.** It carries a meaning, so it cannot be spent on
emphasis.

**Dark is the default for everyone**, system preference included — the palette
is the brand, not an accommodation. Light is an explicit, remembered choice
behind a toggle. Surfaces implement it as `:root[data-theme="light"]`, never as
a bare `prefers-color-scheme` block, or the default stops being a decision.

### Type

- **Bricolage Grotesque** — display and body. Weights 400–600 only; 700 is
  reserved for the wordmark. Authority comes from size and spacing, not weight.
- **JetBrains Mono** — anything the machine says or does: commands, tool calls,
  paths, IDs, memory types, section eyebrows. Never mono for texture.

Both self-hosted, latin-subset, OFL. No CDN, ever.

### Structure

Records, not cards. Hairline rules and uppercase mono eyebrows — a ledger you
scan, shaped like the data underneath. **Zero border-radius, zero shadow, zero
gradient, anywhere.** The only bordered box is a memory, and its border is ochre.

### Motion

Motion must depict a real mechanism — it is explanation, not delight. The
budget is **at most one moving thing in the viewport at a time**, so sequences
are scroll-triggered where they sit rather than all playing at load. Ambient,
continuous motion is allowed only when what is moving is real content (the
landing hero's drifting memory titles are actual memories, not filler).

`prefers-reduced-motion` and JS-off both show the finished frame: the CSS
renders the end state and the animation is additive, never the other way round.

### Imagery

The product's own artifacts only — a tool-call row, a memory card, a flow line,
an MCP response. Nothing is drawn that the system does not actually do.

Never: rounded cards with drop shadows, purple→blue gradients, isometric 3D
servers, stock photos of developers, glowing orbs or neural meshes, a mascot,
a second accent colour, motion without a mechanism.

---

## Consequences

### Now (this session)

Landing page updated to match: team-first subline, more of the system shown
rather than described, self-host section reduced to a pointer at the docs.

### Next

**`app.aznex.ai` is on a different visual system.**
`packages/frontend/src/styles.css` is light-first with its own token set, so a
developer who installs from the landing page and signs in walks into what looks
like a different product. Adopting these tokens in the SPA is the highest-value
branding work remaining — a CSS-variable swap and a dark-first flip, not a
redesign. Worth its own issue.

Smaller, later: the mark in CLI output, GitHub social preview, README header.
