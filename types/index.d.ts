export type MonocleMarkdownArgs<Surface> = {
  surface: Surface
  text: string
  columns: number
}

export type Monocle<Surface, Drawing> = {
  markdown: (args: MonocleMarkdownArgs<Surface>) => Promise<Drawing | undefined>
}

declare module 'claude-code' {
  interface EngineInterface {
    monocle: Monocle<RenderSurface, RenderElement>
  }
  interface PluginState {
    monocle: {
      formulas: Record<string, unknown>
      dir: string
      diagrams: Record<string, unknown>
      diagramDir: string
      headings: Record<string, unknown>
      unfolded: string[]
      zoomLoad: string
      sent: { text: string; at: number }[]
      turnEnds: { durationMs: number; at: number }[]
      drawn: StateFamily<number>
    }
  }
}
