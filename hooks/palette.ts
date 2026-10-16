import type { Theme } from './theme'

export type Palette = { colors: string[]; foreground: string; background: string }

const TERMINAL_KEYS: Record<string, number> = { rainbow_red: 1, rainbow_green: 2, rainbow_yellow: 3, rainbow_indigo: 4, rainbow_violet: 5, rainbow_blue: 6, subtle: 8, inactive: 8 }
const FILLED = ['strong', 'codeText', 'diagramText'] as const

const hexOf = (value: string | undefined): string | null => {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value?.trim() ?? '')?.[1]
  return hex ? `#${hex.toLowerCase()}` : null
}

const paletteOf = (colors: Map<number, string>, foreground: string | null, background: string | null): Palette | null => {
  const sixteen = Array.from({ length: 16 }, (_, i) => colors.get(i) ?? '')
  return foreground && background && sixteen.every(Boolean) ? { colors: sixteen, foreground, background } : null
}

export const kittyPalette = (stdout: string): Palette | null => {
  const colors = new Map<number, string>()
  let foreground: string | null = null
  let background: string | null = null
  for (const line of stdout.split('\n')) {
    const [key, value] = line.trim().split(/\s+/)
    const hex = hexOf(value)
    if (!key || !hex) continue
    const index = /^color(\d+)$/.exec(key)?.[1]
    if (index !== undefined && Number(index) < 16) colors.set(Number(index), hex)
    if (key === 'foreground') foreground = hex
    if (key === 'background') background = hex
  }
  return paletteOf(colors, foreground, background)
}

export const ghosttyPalette = (stdout: string): Palette | null => {
  const colors = new Map<number, string>()
  let foreground: string | null = null
  let background: string | null = null
  for (const line of stdout.split('\n')) {
    const match = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === 'palette') {
      const entry = /^(\d+)\s*=\s*(\S+)$/.exec(value!)
      const hex = hexOf(entry?.[2])
      if (entry && hex && Number(entry[1]) < 16) colors.set(Number(entry[1]), hex)
    }
    if (key === 'foreground') foreground = hexOf(value) ?? foreground
    if (key === 'background') background = hexOf(value) ?? background
  }
  return paletteOf(colors, foreground, background)
}

const named = (color: string, palette: Palette): string | null => {
  const index = TERMINAL_KEYS[color.trim()]
  return index === undefined ? null : palette.colors[index]!
}

export const usesNames = (theme: Theme): boolean => Object.values(theme).some(color => typeof color === 'string' && color.trim() in TERMINAL_KEYS)

const mix = (from: string, to: string, amount: number): string => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount).toString(16).padStart(2, '0')).join('')}`
}

export const paintTheme = (theme: Theme, palette: Palette, fill: boolean): Theme => {
  const painted: Theme = Object.fromEntries(Object.entries(theme).map(([token, color]) => [token, color === undefined ? color : (named(color, palette) ?? color)]))
  if (!fill) return painted
  for (const token of FILLED) painted[token] ??= palette.foreground
  painted.rule = mix(palette.background, palette.foreground, 0.16)
  painted.tableRule = mix(palette.background, palette.foreground, 0.4)
  return painted
}

export const samePalette = (a: Palette | null, b: Palette | null): boolean =>
  a === b || (!!a && !!b && a.foreground === b.foreground && a.background === b.background && a.colors.every((c, i) => c === b.colors[i]))
