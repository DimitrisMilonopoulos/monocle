export type OcellusMarkdownArgs<Surface> = {
  surface: Surface
  text: string
  columns: number
}

export type Ocellus<Surface, Drawing> = {
  markdown: (args: OcellusMarkdownArgs<Surface>) => Promise<Drawing | undefined>
}

declare module 'claude-code' {
  interface EngineInterface {
    ocellus: Ocellus<RenderSurface, RenderElement>
  }
  interface PluginState {
    ocellus: {
      formulas: Record<string, unknown>
      dir: string
      diagrams: Record<string, unknown>
      diagramDir: string
      headings: Record<string, unknown>
      unfolded: string[]
      sent: { text: string; at: number }[]
      turnEnds: { durationMs: number; at: number }[]
      drawn: StateFamily<number>
    }
  }
}
