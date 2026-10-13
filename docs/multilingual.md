# Multilingual verification and demonstration

## Supported languages and display rules

The interface supports French (`fr-FR`), English (`en-GB`) and Spanish (`es-ES`).
The header selector is available to visitors and signed-in members. Its choice
is stored in `localStorage` as `fieldnotes.language`, takes precedence over the
browser's supported language preferences, and survives reload and logout. This
is a browser preference, not an account setting. If storage is blocked, selection
still works for the current visit. Unsupported preferences fall back to French.

`useFormatters()` subscribes to the current language. It provides localized
dates, times, relative dates, numbers, file sizes, lists of names and name sorting.
Translation interpolations use `{{count, number}}` for displayed quantities;
plural selection still receives a number. Team identifiers, season years,
URLs, form values and API date parameters are not reformatted.

- Workdays still follow the server's 4 a.m. boundary. The language never
  determines which workday an entry belongs to.
- Calendar-only ISO dates are formatted with UTC to preserve the exact day,
  including in browsers far from the club's time zone. Weeks start on Monday.
- Timestamps retain the browser's existing local time zone. Switching language
  changes their presentation, not their instant or time zone.
- Native date inputs use the browser's presentation and retain ISO values.
- Photo sizes keep their existing binary divisor and one-decimal rounding;
  localized units display as `Mo` in French and `MB` in English and Spanish.
- Member content, rulebook quotations, glossary definitions and generated Fieldbot
  answers retain their original text. Downloads keep their server format.

## Automated checks

```bash
npm --prefix frontend run check:translations
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test -- --maxWorkers=2
npm --prefix frontend run build
```

Additional time-zone regression check:

```bash
TZ=Pacific/Kiritimati npm --prefix frontend test -- src/app/formatters.test.tsx
```

Regression tests cover:

- Three-language date, relative-date, list, decimal and file-size formats.
- Relative-date boundaries and the Paris daylight-saving transition.
- Immediate updates of already mounted formatter consumers.
- A session summary and calendar changing language while preserving the selected
  ISO day, browsed month, participant names and link destinations, without a new
  API request.
- Analytics chart tables, dates and large quantities changing language while
  retaining the requested period and CSV URL.
- Notifications retaining the actor's name and destination while changing the
  sentence and timestamp presentation.
- A selected profile photo retaining its file and preview when its size changes
  presentation.
- Numeric plural selection and unchanged team identifiers.

## Screen verification matrix

Run each row in French, English and Spanish at mobile and desktop widths. Use a
student account for team work, a mentor for cross-team access and an administrator
for member/team management. Check keyboard focus and labels as well as appearance.

| Screen | What to inspect |
| --- | --- |
| Public landing page | Headings, calls to action, header and footer links |
| Login | Labels, invalid credentials, required fields and preserved draft |
| Sign-up | Labels, validation, consent, success with/without a real email |
| Privacy and terms | Full paragraphs, update date, links, long table cells |
| Missing page | Translated explanation and navigation links |
| Team board | Relative dates, participant conjunctions, counts, filters and suggested names |
| Team notes | Session date, note time, validation and correction controls |
| Analytics | Axes, legends, tooltips, accessible tables, large counts and date filters |
| Session summary | Selected date, navigation, attendance counts and attachment plurals |
| Calendar | Month heading, weekday labels, day descriptions and stable destinations |
| Work item | Open/close dates, history timestamps, names, steps and upload labels |
| Profile | Chosen photo size, progress, preview and account actions |
| Team management | Team labels, member counts, sorting, search and forms |
| Member list and detail | Filters, sorting, status/role labels and confirmations |
| Fieldbot | Interface, glossary controls, counter and retained conversation/draft |
| Header menus | Notifications, account actions, administration and mobile navigation |

### Browser checks performed for #247

Chromium traversed 15 route/state combinations in each language at 360 px and
1280 px: 90 checks with representative API fixtures. These covered public pages,
empty sign-up validation, the signed-in board with its work-item form, analytics,
work-item history, session summary/calendar, profile, team and member management,
Fieldbot with its glossary, and the notification panel.

Seven of the densest screens were also checked in each language at 320 px and
768 px, bringing the matrix to 132 checks across four widths. This exposed
clipped numeric chart-axis labels at 320 px; automatic axis width and additional
chart space fixed them. All three languages were checked again on analytics at
320 px and 768 px after the correction.

No page-wide horizontal overflow, unlabelled visible form controls or buttons,
unhandled browser errors, or unexpected API requests were detected in that
matrix. Analytics tables intentionally scroll inside their own containers.
This is a browser layout and rendering check with a simulated API, not a real
backend end-to-end test or a complete accessibility audit. Real API actions,
actual upload progress and platform-specific native controls should also be
checked on the deployment used for the demonstration.

## Three-minute demonstration

1. On login, enter a display name and submit an incomplete form. Change language:
   labels and existing validation messages update while the entered name stays.
2. Sign in and open a team's board. Switch through the three languages: the same
   participant names use the appropriate conjunction and activity dates update.
3. Open a session and browse to another calendar month. Change language again:
   the month and day descriptions update without changing the chosen session.
4. Open analytics, select a custom period, and switch language. Date labels and
   quantities change; date-input values and the export destination stay the same.
5. Open notifications, then choose a profile photo. Show the translated timestamp
   and localized photo size without sending the photo.
6. Reload and sign out. The selected language remains available and selected.
