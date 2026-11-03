# Promenadis UI

The web app's UI is built on [shadcn/ui](https://ui.shadcn.com) (MIT) with
Tailwind CSS v4. Components live in the repository and are edited like any
other code:

- `apps/web/app/components/ui/` — shadcn primitives (Button, Input, Textarea,
  NativeSelect, Label, Checkbox/Radio, Card, Badge, Alert, Separator, Field).
- `apps/web/app/components/page.tsx` — page layout: `PageMain`, `PageHeading`,
  `Eyebrow`, `EmptyState`, `SummaryList`, `SiteFooter`, and the `siteShell`,
  `skipLink` and `backLink` class strings.
- `apps/web/app/components/page-header.tsx` — the shared header and the
  `headerNavItem` class for its links and buttons.
- `apps/web/app/styles/app.css` — theme tokens. Colours are `light-dark()`
  pairs, so the theme switcher (which sets `color-scheme`) changes them all.
  Use the token utilities (`bg-card`, `text-muted-foreground`, `text-link`,
  `bg-primary`, `bg-success-soft`, `bg-warning-soft`, `bg-destructive-soft`,
  `bg-sun`, `font-display`) instead of raw colours.

`cn()` from `app/lib/utils.ts` merges class names.

## Rules

- Keep semantics: headings keep their level, `role`, `aria-*`, `id`, `htmlFor`,
  `name` and visible text stay exactly as they were. Tests find elements by
  role, label and text.
- Selects stay native (`NativeSelect`) and checkboxes and radios stay native
  (`Checkbox`, `Radio`): forms post them and tests call `selectOption`/`check`.
- `Alert` has no default role. Pass the role the old element had.
- `Card` and `CardTitle` take `asChild` to keep a `<section>`, `<li>`,
  `<form>`, `<details>` or another heading level.
- Buttons that navigate use `<Button asChild><Link …/></Button>`.
- Touch targets are at least 44px (`h-11`; `size="sm"` only in dense rows).

## Old class → new

| Old class | Replacement |
| --- | --- |
| `primary-button` | `<Button>` |
| `secondary-button` | `<Button variant="outline">` |
| `danger-button` | `<Button variant="destructive">` |
| `quiet-button`, `text-button` | `<Button variant="link">` (or `ghost` in toolbars) |
| `primary-button button-link` on `<a>`/`<Link>` | `<Button asChild>` around it |
| `text-link` | plain `<a>`/`<Link>` (base style) with `font-semibold` |
| `panel` | `<Card>` (+ `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`), `asChild` to keep the element |
| `form-panel` | `<Card asChild><form …>` with `CardContent` and `FieldGroup`/`Field` |
| `<label>` + `<input>` | `<Field><Label htmlFor/><Input/></Field>` |
| `field-help`, `field-hint` | `<FieldDescription>` or `text-sm text-muted-foreground` |
| `checkbox-field` | `<ChoiceField><Checkbox/><span>…</span></ChoiceField>` |
| `choice-group` | `<FieldSet><FieldLegend/>…</FieldSet>` |
| `notice` | `<Alert>` |
| `notice notice-error` | `<Alert variant="destructive">` |
| `notice-warning` | `<Alert variant="warning">` |
| `notice-success` | `<Alert variant="success">` |
| `form-status` | `<p className="min-h-6 text-sm font-semibold">` keeping its role/aria-live |
| `status-pill` | `<Badge>`; `status-pill-muted` → `<Badge variant="secondary">` |
| `eyebrow` / `<h1>` / `lede` page tops | `<PageHeading eyebrow title description actions meta>` |
| `account-page`, `app-page`, `flow-page`, `wide-flow-page` `<main>` | `<PageMain width="app" \| "flow" \| "wide">` |
| `back-link` | `className={backLink}` |
| `summary-list` | `<SummaryList>` |
| `empty-state` | `<EmptyState>` |
| `form-actions`, `button-row` | `<div className="flex flex-wrap items-center gap-3">` |
| `details` / `settings-details` / `danger-zone` | `<details>` with `[&>summary]:cursor-pointer [&>summary]:font-semibold`; danger: `text-destructive-foreground` |
| `visually-hidden` | `sr-only` |
| `resource-list`, `team-list`, invite lists | `<ul className="m-0 grid list-none divide-y p-0">` with `py-4` rows |
