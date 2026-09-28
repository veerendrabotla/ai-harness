# AI Harness — Frontend Guidelines

# 1. DESIGN SYSTEM

## Design intent
The interface is a technical control plane. It must prioritize:
1. task state;
2. safety;
3. execution visibility;
4. readable diffs;
5. information density without visual noise.

The product must not imitate a consumer chat application.

## Color palette

### Base
- Background: `#0B1020`
- Surface 1: `#11182A`
- Surface 2: `#182235`
- Surface 3: `#202C42`
- Border: `#2B3850`
- Border strong: `#3A4A66`

### Text
- Primary: `#F4F7FB`
- Secondary: `#B8C2D1`
- Muted: `#7F8A9C`
- Disabled: `#566174`

### Brand
- Primary: `#5B8CFF`
- Primary hover: `#4779F2`
- Primary active: `#3567D9`

### Semantic
- Success: `#35C48A`
- Warning: `#F2B84B`
- Danger: `#F05D5E`
- Info: `#4EA8DE`

### Agent state mapping
- Queued: `#7F8A9C`
- Planning: `#4EA8DE`
- Waiting approval: `#F2B84B`
- Executing: `#5B8CFF`
- Verifying: `#8B7CF6`
- Completed: `#35C48A`
- Failed: `#F05D5E`
- Cancelled: `#7F8A9C`
- Interrupted: `#F08A5D`

Do not use color as the only indicator of state. Every state must include text and an icon or shape.

---

# 2. TYPOGRAPHY

## Font families
- UI: `Inter`
- Code, terminal, diffs: `JetBrains Mono`

## Scale
- Display: 32px / 40px / 700
- H1: 24px / 32px / 700
- H2: 20px / 28px / 700
- H3: 16px / 24px / 600
- Body: 14px / 22px / 400
- Small: 12px / 18px / 400
- Code: 13px / 20px / 400

Do not use body text below 12px.

---

# 3. SPACING SYSTEM

Base unit: **4px**.

Allowed spacing tokens:
- 4
- 8
- 12
- 16
- 20
- 24
- 32
- 40
- 48
- 64

Do not introduce arbitrary spacing values outside this scale unless required by a fixed third-party component.

---

# 4. COMPONENT RULES

## Buttons
Variants:
- Primary.
- Secondary.
- Ghost.
- Danger.
- Outline.

Rules:
- Minimum height: 36px.
- Default horizontal padding: 12px.
- Primary action appears once per logical screen header.
- Destructive actions use the Danger variant.
- Disabled buttons must remain readable but non-interactive.
- A loading button replaces its leading icon with a spinner and prevents duplicate submission.

## Forms
- Every field has a visible label.
- Required fields use visible text, not color alone.
- Validation appears directly below the relevant field.
- Server errors appear in a form-level error region.
- Password and API-key fields must support show/hide control.
- API keys must not be redisplayed after successful save.

## Cards
Use cards only for grouped information with a shared action or status.
- Padding: 16px or 20px.
- Border: 1px solid `#2B3850`.
- Radius: 12px.
- Do not place every paragraph in a card.

## Modals
Use modals only for:
- destructive confirmation;
- approval decisions;
- compact creation flows;
- focused configuration.

Rules:
- Escape closes non-destructive modals.
- Destructive confirmation requires an explicit action.
- Modal focus is trapped.
- Modal background does not scroll.

## Status badges
Every task state badge contains:
- state label;
- icon;
- semantic color.

Never use a bare colored dot as the only state representation.

## Code and terminal blocks
- Use JetBrains Mono.
- Preserve whitespace.
- Support horizontal scrolling.
- Never wrap long terminal commands by default.
- Secret-looking values must be redacted before rendering.

---

# 5. LAYOUT RULES

## Desktop
Minimum target width: 1024px.

Workspace shell:
- Left navigation rail: 240px expanded.
- Main content: fluid.
- Optional right inspector: 320px.
- Inspector collapses below 1280px.

## Tablet
768px to 1023px:
- Navigation rail collapses to icon mode.
- Right inspector becomes a drawer.
- Two-column task panels become one column.

## Mobile
Below 768px:
- Navigation becomes a bottom sheet/drawer.
- Main task summary remains available.
- Dense multi-column tables convert to stacked rows.
- Diff view remains horizontally scrollable.
- Approval actions remain fixed near the bottom when an approval is active.

## Maximum content width
General settings pages: 1200px.
Task execution pages: full available workspace width.

---

# 6. TASK SCREEN STRUCTURE

The task detail page must contain:
1. Task header.
2. Current state.
3. Primary controls: pause/resume/cancel where applicable.
4. Main activity stream.
5. Plan section.
6. Context inspector.
7. Changes/diff section.
8. Verification section.
9. Approval queue.

The default view is the activity stream.

---

# 7. STATE HANDLING

## Loading
- Use skeletons for page-level loading.
- Use inline spinners for action-level loading.
- Do not replace the entire page with a spinner after initial content exists.

## Error
Every error state must include:
- human-readable summary;
- error category;
- retry action when retry is safe;
- technical request ID when available.

Do not display raw stack traces by default.

## Empty
Every empty state must include:
- what is empty;
- why it may be empty;
- the primary action to populate it.

## Offline
The PWA must show:
- offline indicator;
- stale-data timestamp when available;
- disabled actions that require a live connection.

---

# 8. ACCESSIBILITY

1. Target WCAG 2.2 AA contrast.
2. All interactive elements are keyboard reachable.
3. Visible focus indicator is required.
4. Icon-only controls require accessible labels.
5. Status changes announced through appropriate ARIA live regions.
6. Approval modals receive focus.
7. Color is never the only semantic signal.
8. Motion must respect `prefers-reduced-motion`.
9. Terminal and diff output must remain selectable.
10. Toast notifications must not be the only location for critical errors.

---

# 9. DO'S

- Do show exact task state.
- Do show when an agent is waiting for the user.
- Do distinguish plan, execution, and review output.
- Do show tool names and concise action summaries.
- Do expose checkpoint and verification status.
- Do preserve event chronology.
- Do use progressive disclosure for raw tool payloads.
- Do optimize for desktop developers while keeping all critical actions mobile-accessible.

# 10. DON'TS

- Do not present execution as ordinary chat bubbles only.
- Do not hide destructive actions behind ambiguous icons.
- Do not auto-dismiss critical permission requests.
- Do not use red/green without labels.
- Do not silently collapse failed tool output.
- Do not show provider secrets in the UI after save.
- Do not let decorative animation obscure execution state.
- Do not create separate visual systems for each AI provider.
- Do not use inconsistent button wording for the same action.
