# Drawing markdown from another mod

Other mods can draw markdown in the user's theme with `$.monocle.markdown`. Pass the surface, the text and the content width in columns.

- It answers the tree to draw, or `undefined` when monocle is disabled or the text holds nothing to draw.
- It throws when monocle isn't installed, so call it in a `try`.
- Monocle draws at least 20 columns wide. Copy buttons are left out, because a button can't cross from one mod to another.

```tsx
let drawn
try {
  drawn = await $.monocle.markdown({ surface: e.surface, text, columns: e.props.bodyColumns })
} catch {}
return drawn ?? <Markdown text={text} />
```

The types are in [types/index.d.ts](../types/index.d.ts). List monocle under `dependencies` in your `plugin.json` and Claude Code lays them into your `.claude-plugin/types/`. When monocle is optional, declare the noun in your own contract instead:

```ts
declare module 'claude-code' {
  interface EngineInterface {
    monocle: {
      markdown: (args: { surface: RenderSurface; text: string; columns: number }) => Promise<RenderElement | undefined>
    }
  }
}
```
