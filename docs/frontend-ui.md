# Frontend UI conventions

The design system lives in `frontend/src/components/`, with named colours,
fonts and shadows in `frontend/src/styles.css`'s `@theme`. The visual direction
is a working notebook: the club's blue, dark ink, a neutral canvas, white
paper surfaces and fine dividers. No global glow or decorative gradients.

## Layout and visual hierarchy

- Keep page titles compact and reserve the club's blue for actions and selected
  navigation. Status always has a text label; amber remains the handover colour.
- Use small, consistent radii and flat panels. Reserve elevation for menus and
  popovers, not every content block. The landing page alone has a notebook-cover
  treatment, with a solid blue surface and a small offset shadow.
- Team home has a main work-item column and a 19-rem session/notes column on
  desktop. Below the large breakpoint, content follows DOM order in one column:
  work items first, then the session. No fixed-height lists or hidden entries.
- Keep work-item filters, counts, group disclosures and handovers intact. A
  layout change must not change query keys, permissions, routes or API payloads.
- Day summary separates the notebook and attendance; work-item detail gives
  the history more reading width. A closed work item without a current progress
  uses the full history width, not an empty editing column.

## Components own appearance; screens own layout

- Use `Button` for an action, `ButtonLink` for navigation styled as an action,
  and `TextButton` for the existing low-emphasis text actions. Native links
  remain links; never change navigation into an `onClick` button.
- Use `Panel` for the existing card/section surfaces and `Heading`/`Eyebrow`
  for their established type scales. Choose `as` for the semantic heading
  level, independently of its visual size. A definition-list value is not
  a heading simply because it has a large font.
- Use `Label`, `TextInput`, `TextArea` and `Select` for ordinary form fields,
  with `FieldErrors`/`RequestError` for their existing validation messages.
  Keep labels, IDs, names, autocomplete, refs and `aria-describedby` intact.
- Use `Chip`/`StatusChip` for status labels, `Notice` for messages,
  `SuccessMessage` for save confirmations, and `ConfirmPanel` for the
  existing non-form removal confirmations.
- Keep margins, grids, flex alignment, widths and responsive placement in
  the owning screen. Use named tokens (`text-muted`, `bg-tint`,
  `border-primary/20`), not new literal colours.
- Do not override a component's border, padding, typography or focus ring
  with a conflicting utility in `className`: Tailwind rule order, not the
  order of classes in the attribute, decides which wins. Add an explicit
  variant when a recurring appearance genuinely differs.

## Account forms are an explicit variant

Login and signup use the same components as the working screens while
retaining their larger fields, bold labels and full-width action. They use the
same opaque paper surface and small radii as the rest of the application.
`variant="auth"` on `TextInput`, `Label`, `Panel` and `Button` selects that
spacing; `Heading size="auth"` selects a compact display title.
`FieldHint` has compact defaults for working screens and an `auth`
variant retaining the account hints' spacing and font size. The
old `form-label`, `form-input`, `form-hint` and `form-submit` CSS is removed.

```tsx
<Panel as="section" variant="auth">
  <Heading size="auth">{t("login.title")}</Heading>
  <form onSubmit={handleSubmit(save)} className="mt-8 space-y-5">
    <div>
      <Label variant="auth" htmlFor="username">
        {t("login.username")}
      </Label>
      <TextInput
        variant="auth"
        id="username"
        autoComplete="username"
        aria-invalid={Boolean(errors.username)}
        aria-describedby="username-error"
        {...register("username")}
      />
      <FieldErrors id="username-error" message={errors.username?.message} />
    </div>
    <Button variant="auth" type="submit" disabled={pending}>
      {t(pending ? "login.submitting" : "login.submit")}
    </Button>
  </form>
</Panel>
```

`ButtonLink variant="auth"` is the signup success link: it keeps its route
and router state rather than becoming a button. The `auth` button variant
defaults to large padding and the shared small radius; pill shapes remain
available only when explicitly requested. No variant changes the default
`type="button"`.

`Eyebrow` supports the existing tracking values (`tight`, `normal`, `wide`,
`wider`); handover labels use `tight` and `tone="inherit"` so their amber
comes from their notice rather than being replaced by blue.

## Deliberate exceptions from the screen audit

A native tag is not itself duplication. Keep these purpose-built controls
unless a second matching use calls for a shared component:

| Area | Why it retains dedicated presentation |
| --- | --- |
| Header menus, navigation, notification rows, language switcher | Navigation and disclosure controls have their own active states, positioning and keyboard behaviour; they are not ordinary form fields or action buttons. |
| Calendar day links and section tabs | They are navigation with selected/current states and grid sizing. Their styles already live in `ActivityCalendar` and `SectionTabs`. |
| Team section toggle | A button inside a heading which controls `aria-expanded` and `aria-controls`, not a filled action button. |
| File pickers, radio buttons, checkboxes | Keep native input types, labels, groups and browser file behaviour; a text-field wrapper would give them inappropriate presentation. |
| Fieldbot composer, bubbles, citations and glossary | Auto-growing input, Enter/Shift+Enter handling and chat-specific surfaces; not an ordinary textarea/card. |
| Search filter removal chips | Small interactive removable filters, not passive `Chip` spans. |
| Landing notebook cover | A one-off editorial composition with a solid-blue surface; calls to action still use shared buttons. |
| Profile deletion form | Password-confirmed submission with field errors and its own focus behaviour; do not replace it with a non-form `ConfirmPanel`. |
| Legal content, charts and metric grids | Document flow, chart/table semantics and definition lists differ from headings and form panels. |

The `form-link` class remains shared by the inline links in account forms;
Fieldbot's decorative classes and legal typography also remain intentional
global styles. Do not delete them as if they were unused form controls.

## Verify a component change

Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` from
`frontend/`. Shared-component tests cover native props/refs, focus, disabled
actions, variants, navigation semantics and heading levels; page tests keep
validations, payloads and routes under test. Check mobile (320 px) and desktop
in a real browser when changing visual styles, including focus/error states
and all three UI languages. DOM tests do not prove pixel-level visual parity.
