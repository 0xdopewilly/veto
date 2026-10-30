# Motion

Every screen in Veto moves with purpose. These are the rules the web app and the mobile web app follow. The reference prototypes are on the design canvas (Brand › Loader, and the "Full flow" board first on the Mobile app and Desktop web pages, which plays the whole app with every transition).

## Loading
Anything that waits shows the V signing itself (`docs/brand/veto-loader.svg`). The payer's stroke draws, Veto's joins, they seal where they meet, then clear. It is never a generic spinner. Use it inside buttons as well (on sand: black and coral strokes; on coral: black).

## Tokens
| Token | Value | Use |
| --- | --- | --- |
| `push` | 560 ms, `cubic-bezier(.32,.72,0,1)` | screen slides; the screen behind shifts 28% and dims to 45% |
| `rise` | 700 ms, `cubic-bezier(.2,.8,.2,1)`, 18 to 24 px | content entering, staggered 60 to 90 ms |
| `stamp` | 600 ms, `cubic-bezier(.2,1.3,.35,1)`, scale 1.4 to 1 | the VETOED headline |
| `pop` | 420 ms, `cubic-bezier(.2,1.5,.4,1)`, scale .55 to 1 | circuit nodes, status icons |
| `draw` | 420 ms, `cubic-bezier(.4,0,.2,1)`, scaleX 0 to 1 | circuit lines, progress bars |
| `press` | 140 ms, scale .97 | every button and tappable row |
| `reveal` | scroll-driven (`animation-timeline: view()`, entry 0% to cover 28%) | landing and bench sections |

## Moments
- App start: loader, then home rises in order (header, account, decision card, balance, spend, activity).
- Opening a decision: the screen pushes in from the right; VETOED stamps; the circuit builds node by node and the AI node pulses.
- Paid: the check pops and the green line draws through to the payee.
- Freeze: the sheet rises from the bottom over a dimmed screen.
- Desktop: route changes cross-fade and rise; side panels slide in from the right.

## Reduced motion
With `prefers-reduced-motion: reduce`, slides and pops become short opacity fades and the loader breathes instead of drawing. Nothing important is shown only through motion.
