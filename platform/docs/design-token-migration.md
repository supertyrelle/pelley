# Design Token Migration Guide

Migrate hardcoded Tailwind gray classes to Nuxt UI semantic CSS variables.

## Token Mapping

| Old Pattern | New Pattern |
|---|---|
| `bg-gray-50 dark:bg-gray-900` | `bg-(--ui-bg)` |
| `bg-gray-100 dark:bg-gray-800` | `bg-(--ui-bg-muted)` |
| `bg-white dark:bg-gray-900` | `bg-(--ui-bg-elevated)` |
| `bg-gray-200 dark:bg-gray-700` | `bg-(--ui-bg-accented)` |
| `border-gray-200 dark:border-gray-700` | `border-(--ui-border)` |
| `border-gray-100 dark:border-gray-800` | `border-(--ui-border-muted)` |
| `border-gray-300 dark:border-gray-600` | `border-(--ui-border-accented)` |
| `text-gray-900 dark:text-white` | `text-(--ui-text)` |
| `text-gray-500 dark:text-gray-400` | `text-(--ui-text-muted)` |
| `text-gray-400 dark:text-gray-500` | `text-(--ui-text-dimmed)` |
| `text-gray-600 dark:text-gray-400` | `text-(--ui-text-toned)` |
| `text-gray-700 dark:text-gray-300` | `text-(--ui-text-toned)` |
| `text-gray-900 dark:text-gray-100` | `text-(--ui-text-highlighted)` |
| `hover:bg-gray-50 dark:hover:bg-gray-800` | `hover:bg-(--ui-bg-muted)` |
| `hover:bg-gray-100 dark:hover:bg-gray-800` | `hover:bg-(--ui-bg-accented)` |

## Rules

1. **Remove dark: variants.** Each `--ui-*` variable already has light/dark values via `:root` and `.dark` in `main.css`. One class replaces two.
2. **Keep semantic/status colors.** Green, red, yellow, blue, orange classes are semantic (success, error, warning, info, accent) — do NOT migrate them.
3. **Keep Nuxt UI component props.** `color="primary"` on UButton, UBadge, etc. already works via app.config.ts — no changes needed.
4. **Tailwind v4 syntax.** Use `bg-(--ui-bg)` not `bg-[var(--ui-bg)]`. The parenthetical form is the v4 way to reference CSS variables.
5. **Conditional classes.** For ternary/conditional bindings like `'bg-gray-100 dark:bg-gray-800': isActive`, replace with `'bg-(--ui-bg-muted)': isActive`.

## Examples

Before:
```html
<div class="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
  <span class="text-sm font-medium text-gray-900 dark:text-white">Title</span>
  <p class="text-xs text-gray-500 dark:text-gray-400">Description</p>
</div>
```

After:
```html
<div class="border-b border-(--ui-border) bg-(--ui-bg-elevated) px-3 py-2">
  <span class="text-sm font-medium text-(--ui-text)">Title</span>
  <p class="text-xs text-(--ui-text-muted)">Description</p>
</div>
```

## Edge Cases

- **`bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800`** (code/kbd backgrounds): Use `bg-(--ui-bg-muted)`
- **`border-dashed border-gray-300 dark:border-gray-600`**: Use `border-(--ui-border-accented)` (keeps the dashed style, just changes color)
- **Inverted patterns** (dark bg in light mode): Use `bg-(--ui-bg-inverted)` / `text-(--ui-text-inverted)`
- **Pure white in light mode**: Use `bg-(--ui-bg-elevated)` — resolves to white in light, pelley-800 in dark
