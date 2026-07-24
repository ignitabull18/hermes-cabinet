# Contributing translations

Cabinet ships 40 locale bundles today. This doc explains how to add a string,
audit what is still hardcoded, and add another locale. The authoritative
locale set is `SUPPORTED_LOCALES` in `src/i18n/index.ts`; do not maintain a
second hand-written list here.

## File layout

```
src/i18n/
  index.ts                  i18next init (eager-loaded, single file per locale)
  use-locale.ts             useLocale() hook: { t, locale, setLocale, dir }
  formatters.ts             Intl-based date/time/number helpers
  locales/
    en.json                 English source strings, organized by namespace
    he.json                 Hebrew strings
    zh-CN.json              Simplified Chinese strings
    <locale>.json           one consolidated file per supported locale
```

Each locale is **one consolidated JSON file** with namespaces as top-level
keys:

```jsonc
{
  "common": { "actions": { "save": "Save", "cancel": "Cancel" } },
  "editor": { "toolbar": { "bold": "Bold", "italic": "Italic" } },
  "settings": { "language": { "title": "Language" } }
}
```

App locale lives in `localStorage` under `cabinet-locale` and must be a member
of `SUPPORTED_LOCALES`. `LocaleInitializer` applies the selected locale after
hydration. The pre-hydration inline script in `src/app/layout.tsx` currently
recognizes only `en`, `he`, `zh-CN`, and `zh-TW`; the other supported locales
start with English document metadata until hydration. Keep that limitation
visible until the inline list is derived or synchronized.

Per-document direction is separate: every page's `dir: ltr | rtl` lives in
its markdown frontmatter (`src/types/index.ts`). The editor reads it and
respects it, even if the app chrome is the opposite direction.

## Adding a string

1. Pick a namespace from the top level of `en.json` (or create a new one
   if no existing namespace fits; keep the count small).
2. Add the English key and value to `en.json`. Prefer nested objects
   (`toolbar.bold`) over flat keys (`toolbarBold`).
3. Wrap the call site:
   ```tsx
   import { useLocale } from "@/i18n/use-locale";

   export function MyComponent() {
     const { t } = useLocale();
     return <button title={t("editor:toolbar.bold")}>...</button>;
   }
   ```
4. For interpolated values:
   ```tsx
   t("sidebar:refreshedWithChanges", { added, removed })
    // JSON: "refreshedWithChanges": "Refreshed — {{added}} added, {{removed}} removed."
    ```
5. Run `npm run i18n:extract` to add statically detected missing keys to
   `en.json` and `he.json`. This script does not update the other 38 locale
   files.
6. Run `npm run i18n:translate -- --all` with `GOOGLE_AI_API_KEY` configured,
   or update the remaining locale files manually. Missing keys fall back to
   English, but an explicit empty string does not currently fall back because
   i18next's `returnEmptyString` option is not disabled.

## Auto-extracting keys you forgot to add

If you sprinkled new `t()` calls through code but didn't add the keys to
the JSON yet, this script walks `src/` and fills them in:

```sh
npm run i18n:extract         # adds missing keys to en.json and he.json
npm run i18n:check           # exits non-zero if en/he keys are missing
npm run i18n:translate -- --all  # fills missing values in translation targets
```

`i18n:extract` is idempotent: existing keys are preserved, only missing
ones are added. It scans literal `t("namespace:key.path")` calls and does not
prove that every supported locale is complete. Diff the JSON to review.

**Current validation status (2026-07-24):** `npm run i18n:check` reports six
missing English keys and 81 missing Hebrew keys. This is existing translation
debt. The check does not inspect the other 38 catalogs or flag explicit empty
values.

## Finding what's still hardcoded

```sh
npm run i18n:report
```

Walks `src/components/` for JSX text + `title=`/`aria-label=`/`placeholder=`
attribute values that look like user-facing English and aren't wrapped in
`t()`. Best-effort regex pass — false positives happen, but it's the right
starting point for "what's left." Treat the count as a budget that should
trend down.

## Adding a new locale

1. Copy `src/i18n/locales/en.json` to the new BCP-47 locale file.
2. Translate every value.
3. Update `src/i18n/index.ts`: add the import, `SUPPORTED_LOCALES`,
   `LOCALE_LABELS`, and `resources` entries.
4. Add the locale mapping to `LOCALE_TO_BCP47` in
   `src/i18n/formatters.ts`.
5. If the locale is RTL, add its base language to `RTL_LOCALE_PREFIXES` and
   the pre-hydration RTL list in `src/app/layout.tsx`.
6. Run `npm run i18n:check`.
7. Add the locale to `TARGETS` in `scripts/i18n-translate.mjs` if it should be
   maintained by the batch translation workflow.
8. Add it to the pre-hydration supported-locale list in `src/app/layout.tsx`
   until that list is generated from `SUPPORTED_LOCALES`.

`LanguageSection` and onboarding derive their choices from
`SUPPORTED_LOCALES` and `LOCALE_LABELS`; no separate settings list is needed.
There are no per-namespace files to synchronize.

## RTL polish patterns

- **Tailwind utilities:** prefer logical (`ms-2`, `pe-4`, `start-0`, `end-0`)
  over physical (`ml-2`, `pr-4`, `left-0`, `right-0`). They auto-flip when
  `<html dir="rtl">` is active.
- **Directional icons that flip meaning** (back/forward, expand/collapse):
  use the `<DirIcon ltr={IconA} rtl={IconB} />` helper from
  `src/components/ui/dir-icon.tsx`.
- **Purely decorative arrows on "next" buttons:** prefer the Tailwind
  modifier `rtl:rotate-180` over `<DirIcon>` — it's lighter.
- **Animations using `translateX`:** read `dir` from `useLocale()` and flip
  the sign in RTL so items still emerge from the leading edge. See
  `RegistryCarousel` in `src/components/home/home-screen.tsx`.
- **Keyboard ArrowLeft/ArrowRight:** in RTL, ArrowLeft = forward. See
  the `dir`-aware key handler in `src/components/onboarding/tour/tour-modal.tsx`.
- **Per-block auto-direction:** `unicode-bidi: plaintext` + `text-align: start`
  on `.tiptap` / `.registry-prose` block elements means each paragraph
  picks its direction from its first strong character. Layered with
  `dir="auto"` on Tiptap block nodes via the `AutoDirection` extension.

## Agent locale propagation

`createConversation()` in `src/lib/agents/conversation-client.ts` reads
the user's locale from `localStorage` and adds it to every POST to
`/api/agents/conversations`. The server route in
`src/app/api/agents/conversations/route.ts` threads it into the prompt
builders in `src/lib/agents/conversation-runner.ts`, which inject a
"Respond in {{language}}" system instruction near the top of the prompt.
This is how agents reply in the selected UI language.

When `writePage()` (`src/lib/storage/page-io.ts`) saves a note without
explicit `dir` in frontmatter, it auto-detects Hebrew Unicode range
(U+0590–U+05FF) in the first ~600 chars and defaults `dir: rtl` when
Hebrew letters dominate. Explicit frontmatter `dir` always wins.

## What is intentionally not translated

- **Brand mark `cabinet`** — Latin script, kept across locales. Renders
  in Cardo italic when `<html dir="rtl">`.
- **Keyboard shortcuts** (⌘K, ⌘[, ⌘]) — inline, no translation needed.
- **Provider identifiers** (`gemini-cli`, `claude-code`, etc.) — code, not
  prose.
- **Starter team names** in `src/lib/onboarding/rooms.ts` (`Cold Email
  Agency`, `SEO War Room`, etc.) — these are product template names rather
  than locale strings.
- **The dictionary-card intro** in `IntroStep` (English wordplay on
  "cabinet"). The CTA + tagline translate; the dictionary stays English.
- **Auto-update prompt text** — sourced from `update-electron-app`.
