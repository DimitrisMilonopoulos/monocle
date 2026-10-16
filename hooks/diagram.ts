import type { Block } from './markdown'
import type { Theme } from './theme'
import { ratexColor } from './latex'

export type Picture = { png?: string; file: string; width: number; height: number }

export type Diagram = Picture | { error: true }

type Fit = { columns: number; rows: number }

export const MMDC_SCALE = 2
const PX_PER_ROW = 22 * MMDC_SCALE
const CELL_RATIO = 0.46
const MAX_ROWS = 60
const MIN_SCALE = 0.5
export const MAX_DIAGRAMS = 40
const MAX_SOURCE = 20000
const MAX_INLINE_BYTES = 2 * 1024 * 1024
const DIAGRAM_TYPES = ['flowchart', 'sequence', 'gantt', 'journey', 'timeline', 'class', 'state', 'er', 'pie', 'quadrantChart', 'xyChart', 'requirement', 'mindmap', 'kanban', 'gitGraph', 'c4', 'sankey', 'packet', 'block', 'radar', 'architecture']

export const OFFLINE_CHROME = ['--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND']

export const puppeteerConfig = (executablePath?: string): Record<string, unknown> => ({ ...(executablePath ? { executablePath } : {}), args: OFFLINE_CHROME })

export const BROWSERS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

export const mermaidOf = (block: Block): string | null => {
  if (block.kind !== 'code' || block.lang.toLowerCase() !== 'mermaid' || block.isOpen) return null
  const source = block.lines.join('\n').trim()
  return source === '' || source.length > MAX_SOURCE ? null : source
}

const channels = (color: string): [number, number, number] | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(ratexColor(color))?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export const colorHex = (color: string | undefined, fallback: string): string => hexOf(color, fallback)

const hexOf = (color: string | undefined, fallback: string): string => {
  const rgb = color ? channels(color) : null
  return rgb ? `#${rgb.map(n => n.toString(16).padStart(2, '0')).join('')}` : fallback
}

const luminance = (color: string): number => {
  const rgb = channels(color)
  return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 1
}

export const mermaidConfig = (theme: Theme): Record<string, unknown> => {
  const text = hexOf(theme.diagramText ?? theme.codeText, '#808080')
  const darkMode = luminance(text) > 0.5
  const line = hexOf(theme.diagram ?? theme.accent, text)
  const fill = hexOf(theme.rule ?? theme.tableRule, darkMode ? '#3a3a3a' : '#e0e0e0')
  const border = hexOf(theme.tableRule ?? theme.diagram, line)
  const palette = [...new Set([theme.link, theme.number, theme.heading, theme.emphasis, theme.path, theme.codeFlag, theme.accent].flatMap(c => (c && channels(c) ? [hexOf(c, text)] : [])))]
  const pies = Object.fromEntries((palette.length ? palette : [line]).flatMap((c, i, all) => [i, i + all.length].filter(n => n < 12).map(n => [`pie${n + 1}`, c])))
  return {
    ...Object.fromEntries(DIAGRAM_TYPES.map(type => [type, { useMaxWidth: false }])),
    theme: 'base',
    themeVariables: {
      darkMode,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      primaryColor: fill,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: fill,
      secondaryTextColor: text,
      tertiaryColor: fill,
      tertiaryTextColor: text,
      mainBkg: fill,
      nodeBorder: line,
      nodeTextColor: text,
      textColor: text,
      lineColor: line,
      titleColor: hexOf(theme.heading, text),
      clusterBkg: fill,
      clusterBorder: border,
      edgeLabelBackground: fill,
      actorBkg: fill,
      actorBorder: line,
      actorTextColor: text,
      actorLineColor: border,
      signalColor: text,
      signalTextColor: text,
      labelBoxBkgColor: fill,
      labelBoxBorderColor: line,
      labelTextColor: text,
      loopTextColor: text,
      activationBkgColor: fill,
      activationBorderColor: line,
      noteBkgColor: fill,
      noteBorderColor: hexOf(theme.emphasis, line),
      noteTextColor: text,
      ...pies,
      pieTitleTextColor: text,
      pieSectionTextColor: darkMode ? '#000000' : '#ffffff',
      pieLegendTextColor: text,
      pieStrokeColor: fill,
      pieOuterStrokeColor: border,
      xyChart: {
        backgroundColor: 'transparent',
        titleColor: text,
        xAxisLabelColor: text,
        xAxisTitleColor: text,
        xAxisTickColor: border,
        xAxisLineColor: border,
        yAxisLabelColor: text,
        yAxisTitleColor: text,
        yAxisTickColor: border,
        yAxisLineColor: border,
        plotColorPalette: (palette.length ? palette : [line]).join(','),
      },
    },
  }
}

export const diagramKey = (themeKey: string, source: string) => `${themeKey}\0${source}`

export const batchMarkdown = (sources: readonly string[]): string => sources.map(s => `\`\`\`mermaid\n${s}\n\`\`\`\n`).join('\n')

export const batchOutput = (dir: string, batch: string, index: number) => `${dir}/${batch}-${index + 1}.png`

export const inlinable = (base64: string): boolean => (base64.length * 3) / 4 <= MAX_INLINE_BYTES

export const fitDiagram = (size: { width: number; height: number }, columns: number, maxRows = MAX_ROWS): Fit | null => {
  const room = Math.min(255, columns - 2)
  if (room < 8 || size.width < 1 || size.height < 1) return null
  const aspect = size.width / size.height / CELL_RATIO
  const natural = size.height / PX_PER_ROW
  let rows = Math.max(1, Math.min(255, maxRows, Math.round(natural)))
  if (Math.round(aspect * rows) > room) rows = Math.max(1, Math.floor(room / aspect))
  if (rows < natural * MIN_SCALE) return null
  return { columns: Math.max(1, Math.min(room, Math.round(aspect * rows))), rows }
}
