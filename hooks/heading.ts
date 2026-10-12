import type { Theme } from './theme'

export const HEADING_PX_PER_ROW = 34
const CELL_RATIO = 0.46

export const KITTY_FONT = 'from kitty.config import load_config; from kitty.constants import config_dir; import os; print(load_config(os.path.join(config_dir, "kitty.conf")).font_family.created_from_string)'

export const labelText = (lines: readonly string[]): string =>
  lines.map((line, i) => {
    const escaped = line.replace(/\\/g, '\\\\').replace(/%/g, '%%')
    return i === 0 && escaped.startsWith('@') ? `\\${escaped}` : escaped
  }).join('\\n')

export const ghosttyFont = (config: string): string | null =>
  [...config.matchAll(/^font-family[ \t]*=[ \t]*(.*?)[ \t]*$/gm)].map(m => m[1]!.replace(/^"(.*)"$/, '$1')).find(Boolean) ?? null

export const headingColor = (t: Theme, level: number): string | undefined =>
  [t.heading, t.accent, t.link, t.number, t.emphasis, t.emphasis][level - 1] ?? t.heading

export const headingRows = (level: number): number => (level === 1 ? 3 : level === 2 ? 2 : 0)

export const wrapHeading = (text: string, maxChars: number): string[] => {
  const lines: string[] = []
  let line: string[] = []
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let chars = [...word]
    const room = maxChars - line.length - (line.length ? 1 : 0)
    if (chars.length > room && line.length) {
      lines.push(line.join(''))
      line = []
    }
    while (chars.length > maxChars) {
      lines.push(chars.slice(0, maxChars).join(''))
      chars = chars.slice(maxChars)
    }
    line = line.length ? [...line, ' ', ...chars] : chars
  }
  if (line.length) lines.push(line.join(''))
  return lines
}

export type HeadingSource = { level: number; color: string; lines: string[] }

export const headingSource = (heading: HeadingSource): string => JSON.stringify(heading)

export const parseHeadingSource = (source: string): HeadingSource => JSON.parse(source) as HeadingSource

export const fitHeading = (size: { width: number; height: number }, heading: HeadingSource, columns: number): { columns: number; rows: number } | null => {
  const rows = heading.lines.length * headingRows(heading.level)
  if (rows < 1 || size.width < 1 || size.height < 1) return null
  const width = Math.max(1, Math.round((rows * size.width) / size.height / CELL_RATIO))
  return width <= Math.min(255, columns) && rows <= 255 ? { columns: width, rows } : null
}
