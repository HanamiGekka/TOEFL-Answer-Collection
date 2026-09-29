# UI Theme

Last updated: 2026-07-25.

## Name and boundary

Theme name: `TOEFL Reference Light Theme`.

This theme follows visual patterns in read-only `Demand/` references: a white workspace, deep-teal navigation, teal actions, dark body text, and gray separators. All values are local approximations, not an official ETS theme or palette. The app does not copy prompts, images, options, or answers from the references.

The theme changes presentation only. It does not change Blueprint, schema, Store, timing, Recovery, export, shortcuts, or Rust path behavior.

## Single source

- `app/src/styles/theme.css`: Theme name and color, radius, and shadow tokens.
- `app/src/styles.css`: Component and responsive styles consuming tokens only.
- `app/src/main.tsx`: Loads tokens before component styles.

Automated tests prohibit hexadecimal or RGB colors in component CSS and check that old core blue-black background values do not re-enter the theme.

## Final color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--color-brand-header` | `#0f7478` | Header, navigation, primary actions |
| `--color-brand-header-hover` | `#0b6266` | Brand-button hover |
| `--color-brand-action` | `#168d94` | Secondary-action border and hover |
| `--color-brand-accent` | `#19cdb5` | Current navigation and brand accent |
| `--color-brand-accent-soft` | `#ddf7f2` | Soft brand-accent surface |
| `--color-canvas` | `#ffffff` | Main canvas |
| `--color-surface` | `#f7f9f9` | Secondary surface |
| `--color-surface-muted` | `#eef2f2` | Disabled state, explanatory areas, scrollbar track |
| `--color-surface-elevated` | `#ffffff` | Cards, inputs, dialogs |
| `--color-surface-brand` | `#edf8f7` | Light brand surface |
| `--color-surface-warning` | `#fff7e0` | Warning/uncertain surface |
| `--color-surface-danger` | `#fff0ee` | Error/overtime surface |
| `--color-surface-success` | `#eaf6f0` | Success surface |
| `--color-text-primary` | `#192328` | Body text |
| `--color-text-secondary` | `#5d686e` | Secondary text |
| `--color-text-on-brand` | `#ffffff` | Text on brand surfaces |
| `--color-text-on-brand-muted` | `#d8f0ef` | Secondary text on brand surfaces |
| `--color-text-warning` | `#714300` | Warning text |
| `--color-text-danger` | `#8e1b13` | Error text |
| `--color-text-success` | `#166344` | Success text |
| `--color-border` | `#d5dddd` | Ordinary borders/separators |
| `--color-border-strong` | `#aebbbc` | Control/dialog borders |
| `--color-current` | `#d99a00` | Yellow current-question outline |
| `--color-answered` | `#0f7478` | Answered |
| `--color-skipped` | `#66747a` | Skipped |
| `--color-uncertain` | `#a45c00` | Uncertain |
| `--color-overtime` | `#b42318` | Overtime |
| `--color-danger` | `#b42318` | Destructive actions/errors |
| `--color-focus-ring` | `#08747a` | Keyboard focus |
| `--color-overlay` | `#123a3dcc` | Modal backdrop |
| `--color-shadow` | `#1335381f` | Low-intensity shadow |
| `--color-scrollbar` | `#aebbbc` | Scrollbar thumb |
| `--color-scrollbar-hover` | `#7c8d8e` | Scrollbar hover |
| `--color-selection` | `#c9f1ea` | Text selection |

## Non-color tokens

| Token | Value |
| --- | --- |
| `--radius-control` | `8px` |
| `--radius-card` | `12px` |
| `--radius-dialog` | `16px` |
| `--shadow-soft` | `0 4px 14px var(--color-shadow)` |
| `--shadow-dialog` | `0 14px 38px var(--color-shadow)` |

## Status and accessibility constraints

- Current uses a yellow outline and retains `aria-current`; answered uses teal; skipped uses a gray dashed outline; uncertain uses an amber border and light surface; overtime/error uses a red border and light-red surface.
- Status names remain visible in the answer card, header, Summary, or dialogs. Color is never the only cue.
- Automated tests calculate core contrast for ordinary text, secondary text, text on brand surfaces, and focus rings. Primary buttons use deep teal with white text meeting ordinary-text AA contrast.
- Disabled uses a solid light-gray surface, secondary text, and border with `opacity: 1`; focus uses a 3px deep-teal outline.
- There is no flashing or large-area animation. Overlays use only a static translucent backdrop and light blur.
- Home, Records, and Settings passed no-horizontal-scroll E2E at 560, 720, and 900px. Question, Writing, Summary, and overlays have separate stable DOM/class contracts.
