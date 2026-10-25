# Design: Q-Niño

The six working views share this system. Existing scientific copy, data, formulas,
controls, hash destinations and the Q-Niño mark are preserved.

## System
- Genre: modern-minimal
- Scope: full redesign of app screens in the existing tab shell
- Theme: Hallmark Cobalt, explicitly requested
- Default: cool near-white paper, restrained cobalt selection/actions, graphite results
- Signature: editable symmetric F and D matrices with live paired selection

## Tokens
`css/tokens.css` owns palette, type, spacing, control heights and motion.
`css/base.css` supplies the Hallmark base; `css/styles.css` composes the app.
Familjen Grotesk heads, IBM Plex Sans body/labels, JetBrains Mono code and values.
Legacy palette identifiers remain selectable, persisted by the existing theme picker.

## Layout
- Simulator: problem editor on the left, changes and map on the right; brigade setup,
  F and D matrices, then solve controls; results below both columns. Narrow screens
  stack the editor, map and results in that reading order.
- Animation: transport, stage state, amplitudes and threshold history
- Calculators: preserved four sub-tabs with fields and numerical outputs
- Comparison: metric row, logarithmic/ratio charts, measured-result ledger
- Exercises: case list with original provenance and pending cases
- Reference: definitions, actual circuit, limitations and interactive formulas

## Controls and motion
Keycap buttons, hairline surfaces, a single cobalt primary recipe, visible focus.
44px touch targets; small controls sit in an app density range.
Motion communicates state; the user toggle and OS reduced-motion are respected.
No ambient clouds, logo loops or animated chart dimensions.

## Preservation
The original logo and favicon file are unchanged. Scientific caveats are verbatim.
No new scientific claims, external calls, numerical algorithms or datasets.

## Exports
`css/tokens.css`; no framework or dependency migration.
