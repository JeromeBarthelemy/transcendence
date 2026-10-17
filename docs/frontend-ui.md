# Frontend UI conventions

The design system lives in `frontend/src/components/`, with named colours,
fonts and shadows in `frontend/src/styles.css`'s `@theme`. This is not a new
layout or visual identity: the shared components preserve existing screens.

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
retaining their larger fields, bold labels, translucent frame and full-width
pill action. `variant="auth"` on `TextInput`, `Label`, `Panel` and `Button`
selects that appearance; `Heading size="auth"` retains the original title
scale. `FieldHint` has compact defaults for working screens and an `auth`
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
defaults to large padding and a pill shape; other variants retain their
existing defaults. No variant changes the default `type="button"`.

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
| Landing hero and its calls to action | A one-off marketing composition; its decorative gradient, scale and link styling are not working-screen defaults. |
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
