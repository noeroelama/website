# Design tokens

## What it does

One global stylesheet holds every colour, font setting, size, spacing, radius, shadow and motion
value. web, admin and shop import it, so changing a token changes all three apps.

## Where it lives

- Tokens and base styles: `packages/ui/src/styles.css` (exported as `@website/ui/styles.css`)
- Font: Poppins via `next/font` in each app's `src/app/layout.tsx` (CSS variable `--font-poppins`)
- App-specific classes: `apps/<app>/src/app/globals.css` (admin: side panel)
- Tests: `tests/unit/design-tokens.test.ts`

## How to use it

Each app's root layout loads the font and the stylesheet once:

```tsx
import { Poppins } from "next/font/google";
import "@website/ui/styles.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});
// <html lang="en" className={poppins.variable}>
```

In CSS, always use a token: `color: var(--color-text); padding: var(--space-4);`.

| Group      | Tokens                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| Brand      | `--color-brand-950` #220709, `-800` #551D22, `-600` #A63232, `-200` #E8D8CB, `-50` #FBF3EC                  |
| Semantic   | `--color-bg`, `-surface`, `-text`, `-text-muted`, `-primary`, `-border`, `-danger`, panel colours…          |
| Type       | `--text-xs` … `--text-6xl` with matching `--leading-*`; classes `.text-xs` … `.text-6xl`                    |
| Layout     | `--space-*`, `--radius-*`, `--size-*`, `--shadow-popover`, `--duration-*`, `--ease-out`                     |
| Components | `.ui-shell`, `.ui-form`, `.ui-field`, `.ui-input`, `.ui-button`, `.ui-message`, `.ui-status`, `.ui-error-*` |

Type scale (Poppins): 6xl 60/1.0 (PPIDK Asiania) · 5xl 48/1.0 (big title) · 4xl 36/1.2 (page title,
hero) · 3xl 30/1.2 (hero subtitle) · 2xl 24/1.3 (section/card title) · xl 20/1.4 (small title) ·
lg 18/1.5 (intro) · base 16/1.5 (body) · sm 14/1.5 (secondary/meta) · xs 12/1.5 (label/date).

## Rules and assumptions

- Use semantic tokens (`--color-primary`) in components, brand tokens only inside `styles.css`.
- No hex/rgb/hsl colours outside `styles.css`; colour, font, radius, spacing, gap and shadow
  properties in app CSS must use `var(--…)` (or 0/auto/none/inherit/transparent/currentColor).
  `tests/unit/design-tokens.test.ts` fails otherwise.
- Need a new value? Add a token to `styles.css` first, then use it.
