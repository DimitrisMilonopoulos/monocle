import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import { clockText, endedAt, promptKey, sentAt, withRecord } from './clock'
import type { Diagram, Picture } from './diagram'
import { BROWSERS, MAX_DIAGRAMS, MMDC_SCALE, batchMarkdown, batchOutput, colorHex, diagramKey, fitDiagram, inlinable, mermaidConfig, mermaidOf } from './diagram'
import type { HeadingSource } from './heading'
import type { Facts, Platform } from './doctor'
import { doctorText } from './doctor'
import type { PastedSource } from './paste'
import { fitPreview, imageRefs, pastedImages } from './paste'
import { HEADING_PX_PER_ROW, KITTY_FONT, fitHeading, ghosttyFont, headingColor, headingRows, headingSource, labelText, parseHeadingSource, wrapHeading } from './heading'
import type { Formula } from './latex'
import { LATEX_DPR, LATEX_FONT_PX, fitsImage, keepFormulas, mathOf, padFor, pickFormula, pngSize, ratexColor, renderedOf } from './latex'
import type { Block } from './markdown'
import { inlineText, parse, texText } from './markdown'
import type { ClipboardBackend } from './clipboard'
import { clipboardCommand } from './clipboard'
import { boxArt, inlineMarks, mermaidText, shortenEdgeLabels, unsupportedKind } from './mermaid'
import type { Drawn, Fold } from './render'
import { isReadOnlyCall, remember, rememberCall, renderBlocks, renderDiffCard, renderExpandedShell, renderFailure, renderShellResult, renderToolGroup, renderToolRow, renderTurnDuration, renderUserPrompt, width } from './render'
import { helpText, rtlShowcaseText, showcaseText } from './help'
import { PRESET_NAMES } from './presets'
import type { Style } from './theme'
import { RANDOM_THEMES, pickTheme, resolveStyle } from './theme'
import type { Terminal } from './rtl'
import { TERMINALS, hasRtl } from './rtl'

const HINT = [
  'Replies in this session are drawn by the ocellus mod, which runs inside Claude Code and is not a command or tool to call: when the user asks to show something with ocellus, write it as markdown in the reply.',
  'Markdown tables, GitHub alerts (> [!WARNING], > [!NOTE]), fenced code with a language tag, and ```mermaid blocks render as colored terminal graphics:',
  'flowcharts, sequence diagrams and xychart-beta bar or line charts.',
  'When a reply carries a numeric series or a flow that is easier to see than read, add one small diagram or chart with short labels.',
  'Skip diagrams for simple answers.',
  'Put any command or snippet the user may run or copy in a fenced block with a language tag, never inline code: fenced blocks get a copy button, inline code does not.',
].join(' ')

const MERMAID_HINT = 'This terminal also renders ```mermaid blocks as real images, so every mermaid diagram type works here: pie, gantt, mindmap, timeline, quadrantChart, gitGraph and journey as well as flowcharts, sequence, state, class, ER and xychart-beta.'

const LATEX_HINT = 'This terminal typesets LaTeX math: a formula in $$…$$ on lines of its own, or in a ```math block, renders as an image (KaTeX syntax). Inline $…$ does not render, so write inline math as plain text or Unicode.'

const detectTerminal = async ($: EngineInterface): Promise<Terminal | null> => {
  const program = await $.env.get('TERM_PROGRAM')
  const term = await $.env.get('TERM')
  if ((await $.env.get('KITTY_WINDOW_ID')) || term === 'xterm-kitty') return 'kitty'
  if (program === 'Apple_Terminal') return 'apple-terminal'
  if (program === 'WarpTerminal') return 'warp'
  if (program === 'ghostty' || term === 'xterm-ghostty' || (await $.env.get('GHOSTTY_RESOURCES_DIR'))) return 'ghostty'
  if (program === 'WezTerm') return 'wezterm'
  if (program === 'vscode') return 'vscode'
  if (program === 'iTerm.app') return 'iterm'
  if (term === 'alacritty' || (await $.env.get('ALACRITTY_WINDOW_ID'))) return 'alacritty'
  if (await $.env.get('WT_SESSION')) return 'windows-terminal'
  if (await $.env.get('VTE_VERSION')) return 'gnome'
  if (await $.env.get('KONSOLE_VERSION')) return 'konsole'
  return null
}

const applyRtl = (style: Style, terminal: Terminal | null): Terminal | null => {
  if (style.rtl === 'off') return null
  if (style.rtl !== 'auto') return style.rtl
  style.reorder = terminal !== null
  if (terminal) style.shape = TERMINALS[terminal]
  return terminal
}

const expandedCalls = new Set<string>()
const readOnlyCalls = new Set<string>()

const markExpanded = (id: string) => {
  expandedCalls.delete(id)
  expandedCalls.add(id)
  if (expandedCalls.size > 500) expandedCalls.delete(expandedCalls.values().next().value!)
}

const columnsOf = (viewport?: { columns?: number }) => Math.max(20, (viewport?.columns ?? 100) - 4)

const formulas = atom({ plugin: 'ocellus', key: 'formulas' } as const, {})
const latexDir = atom({ plugin: 'ocellus', key: 'dir' } as const, '')
const diagrams = atom({ plugin: 'ocellus', key: 'diagrams' } as const, {})
const diagramDir = atom({ plugin: 'ocellus', key: 'diagramDir' } as const, '')
const headings = atom({ plugin: 'ocellus', key: 'headings' } as const, {})
const MAX_HEADINGS = 100
const unfolded = atom({ plugin: 'ocellus', key: 'unfolded' } as const, [] as string[])
const sent = atom({ plugin: 'ocellus', key: 'sent' } as const, [])
const turnEnds = atom({ plugin: 'ocellus', key: 'turnEnds' } as const, [])

const firstDrawn = async ($: EngineInterface, id: string): Promise<number> => {
  const ref = { plugin: 'ocellus', key: 'drawn', id } as const
  const { value } = await $.state.get(ref)
  if (value !== undefined) return value
  const now = await $.clock.now()
  $.clock.after(0, () => void $.state.set(ref, now, { ifVersion: 0 }))
  return now
}

type Typeset = Exclude<Formula, { error: true }> & { tex: string }

const showsImages = async ($: EngineInterface): Promise<boolean> => {
  if (await $.env.get('TMUX')) return false
  const terminal = await detectTerminal($)
  return terminal === 'kitty' || terminal === 'ghostty'
}

type Latex = { command: string; dir: string }
type LatexSession = { style: Style; color: string; pending: Set<string>; wanted: Set<string>; batch: string[]; engine?: Promise<Latex | null>; ready?: Latex | null; stopped?: boolean; queue: Promise<void> }

const formulaKey = (latex: LatexSession, tex: string) => `${latex.color}\0${tex}`

const typeset = async ($: EngineInterface, latex: LatexSession, engine: Latex, texs: string[], fontSize = LATEX_FONT_PX, dpr = LATEX_DPR): Promise<Formula[]> => {
  const { stdout } = await $.process.run(
    [engine.command, '--output-dir', engine.dir, '--color', latex.color, '--background-color', 'transparent', '--font-size', String(fontSize), '--dpr', String(dpr)],
    { stdin: `${texs.join('\n')}\n`, timeoutMs: 2000 },
  )
  const rendered = renderedOf(stdout)
  return Promise.all(texs.map(async (_, i): Promise<Formula> => {
    if (!rendered.has(i + 1)) return { error: true }
    const png = await $.fs.read(`${engine.dir}/${String(i + 1).padStart(4, '0')}.png`, { as: 'bytes' }).then(r => r.base64, () => '')
    const size = png ? pngSize(png) : null
    return size && fitsImage(png) ? { png, ...size } : { error: true }
  }))
}

const withPadding = async ($: EngineInterface, latex: LatexSession, engine: Latex, texs: string[], results: Formula[]): Promise<Formula[]> => {
  const padded: Formula[] = []
  for (const [i, result] of results.entries()) {
    const pad = 'png' in result ? padFor(result) : null
    const [again] = pad ? await typeset($, latex, engine, [texs[i]!], pad.fontSize, pad.dpr).catch((): Formula[] => []) : []
    padded.push(again && 'png' in again && 'png' in result ? { ...result, padded: again } : result)
  }
  return padded
}

const startLatex = async ($: EngineInterface, latex: LatexSession): Promise<Latex | null> => {
  if (!latex.style.latex || !(await $.session.surfaces()).includes('terminal') || !(await showsImages($))) return null
  const tmp = (await $.env.get('TMPDIR')) ?? (await $.env.get('TEMP')) ?? '/tmp'
  const suffix = (await read($, latexDir)) || crypto.randomUUID()
  await update($, latexDir, () => suffix)
  const engine = { command: 'ratex-render', dir: `${tmp.replace(/[\\/]+$/, '')}/ocellus-latex-${await $.session.id()}-${suffix}` }
  const [check] = await typeset($, latex, engine, ['x^2'])
  return check && 'png' in check ? engine : null
}

const latexEngine = ($: EngineInterface, latex: LatexSession): Promise<Latex | null> =>
  (latex.engine ??= startLatex($, latex)
    .catch(() => null)
    .then(engine => {
      latex.ready = engine
      if (engine) $.ui.invalidate('ui.render')
      return engine
    }))

const stopLatex = (latex: LatexSession) => {
  latex.stopped = true
  latex.pending.clear()
  latex.batch = []
}

const typesetLater = async ($: EngineInterface, latex: LatexSession, texs: string[]): Promise<void> => {
  const engine = await latexEngine($, latex)
  if (!engine || latex.stopped) return
  const results = await typeset($, latex, engine, texs).then(
    done => withPadding($, latex, engine, texs, done),
    () => null,
  )
  if (!results) return stopLatex(latex)
  const fresh = texs.map((tex, i) => [formulaKey(latex, tex), results[i]!] as const)
  await update($, formulas, store => keepFormulas(store, fresh, latex.wanted))
  latex.wanted.clear()
  for (const tex of texs) latex.pending.delete(formulaKey(latex, tex))
}

const mathOfBlocks = async ($: EngineInterface, latex: LatexSession, surface: string, blocks: Block[]): Promise<Map<number, Typeset>> => {
  const maths = [...blocks.entries()].flatMap(([i, block]) => {
    const tex = mathOf(block)
    return tex === null ? [] : [{ i, tex, key: formulaKey(latex, tex) }]
  })
  if (surface !== 'terminal' || maths.length === 0) return new Map()
  void latexEngine($, latex)
  if (!latex.ready) return new Map()
  for (const { key } of maths) latex.wanted.add(key)
  const store = (await read($, formulas)) as Record<string, Formula>
  const missing = latex.stopped ? [] : [...new Map(maths.map(({ key, tex }) => [key, tex]))].filter(([key]) => !store[key] && !latex.pending.has(key))
  if (missing.length) {
    if (latex.batch.length === 0) {
      $.clock.after(0, () => {
        const texs = latex.batch
        latex.batch = []
        latex.queue = latex.queue.then(() => typesetLater($, latex, texs)).catch(() => stopLatex(latex))
      })
    }
    for (const [key, tex] of missing) {
      latex.pending.add(key)
      latex.batch.push(tex)
    }
  }
  return new Map(maths.flatMap(({ i, tex, key }) => {
    const formula = store[key]
    return formula && 'png' in formula ? [[i, { tex, ...formula }] as const] : []
  }))
}

type Mermaid = { dir: string; puppeteer?: string }
type Job = { key: string; source: string }
type Painter = {
  style: Style
  limit: number
  kind: 'mermaid' | 'headings'
  pending: Set<string>
  wanted: Set<string>
  batch: Job[]
  engine?: Promise<Mermaid | Headings | null>
  ready?: Mermaid | Headings | null
  stopped?: boolean
  queue: Promise<void>
}
type MermaidSession = Painter

const painter = (style: Style, kind: Painter['kind'], limit: number): Painter =>
  ({ style, kind, limit, pending: new Set(), wanted: new Set(), batch: [], queue: Promise.resolve() })

const themeKeys = new WeakMap<Style['theme'], string>()

const hashOf = (text: string): string => {
  let hash = 2166136261
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return hash.toString(36)
}

const themeKeyOf = (theme: Style['theme']): string => {
  const known = themeKeys.get(theme)
  if (known) return known
  const key = hashOf(JSON.stringify(mermaidConfig(theme)))
  themeKeys.set(theme, key)
  return key
}

const tmpDir = async ($: EngineInterface): Promise<string> => ((await $.env.get('TMPDIR')) ?? (await $.env.get('TEMP')) ?? '/tmp').replace(/[\\/]+$/, '')

const workDir = async ($: EngineInterface, kind: string): Promise<string> => {
  const suffix = (await read($, diagramDir)) || crypto.randomUUID()
  await update($, diagramDir, () => suffix)
  return `${await tmpDir($)}/ocellus-${kind}-${await $.session.id()}-${suffix}`
}

const drawsImages = async ($: EngineInterface): Promise<boolean> => (await $.session.surfaces()).includes('terminal') && (await showsImages($))

const startMermaid = async ($: EngineInterface, style: Style): Promise<Mermaid | null> => {
  if (!style.mermaidImages || !(await drawsImages($))) return null
  const version = await $.process.run(['mmdc', '--version'], { timeoutMs: 15000 })
  if (version.exitCode !== 0) return null
  const dir = await workDir($, 'mermaid')
  const browser = await findBrowser($)
  if (browser?.kind !== 'system') return { dir }
  const puppeteer = `${dir}/puppeteer.json`
  await $.fs.write(puppeteer, JSON.stringify({ executablePath: browser.path }))
  return { dir, puppeteer }
}

const findBrowser = async ($: EngineInterface): Promise<{ kind: 'puppeteer' } | { kind: 'system'; path: string } | null> => {
  const home = await $.env.get('HOME')
  const bundled = (await $.env.get('PUPPETEER_CACHE_DIR')) ?? (home ? `${home}/.cache/puppeteer` : '')
  if ((await $.env.get('PUPPETEER_EXECUTABLE_PATH')) || (bundled && (await $.fs.exists(bundled)))) return { kind: 'puppeteer' }
  for (const path of BROWSERS) if (await $.fs.exists(path)) return { kind: 'system', path }
  return null
}

const commandPath = async ($: EngineInterface, name: string): Promise<string | null> => {
  const result = await $.process.run(['sh', '-c', 'command -v "$1"', 'which', name], { timeoutMs: 5000 }).catch(() => null)
  return (result?.exitCode === 0 && result.stdout.trim()) || null
}

const platformOf = async ($: EngineInterface): Promise<Platform> => {
  const result = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => null)
  const name = result?.stdout.trim()
  return name === 'Darwin' ? 'mac' : name === 'Linux' ? 'linux' : 'other'
}

const doctorFacts = async ($: EngineInterface, style: Style): Promise<Facts> => {
  const terminal = await detectTerminal($)
  const [platform, mmdc, browser, magick, fcMatch, ratex] = await Promise.all([platformOf($), commandPath($, 'mmdc'), findBrowser($), imageMagick($), commandPath($, 'fc-match'), commandPath($, 'ratex-render')])
  return {
    platform,
    terminal,
    tmux: !!(await $.env.get('TMUX')),
    mmdc,
    browser: browser ? (browser.kind === 'system' ? browser.path : "puppeteer's own Chrome") : null,
    magick,
    fcMatch,
    font: magick && fcMatch ? ((await fontFile($, await terminalFont($)))?.split('/').pop() ?? null) : null,
    kittyRemote: terminal === 'kitty' ? !!(await $.env.get('KITTY_LISTEN_ON')) : null,
    ratex,
    latex: style.latex,
  }
}

const painterEngine = ($: EngineInterface, p: Painter): Promise<Mermaid | Headings | null> =>
  (p.engine ??= (p.kind === 'mermaid' ? startMermaid($, p.style) : startHeadings($, p.style))
    .catch(() => null)
    .then(engine => {
      p.ready = engine
      if (engine) $.ui.invalidate('ui.render')
      return engine
    }))

const stopPainter = (p: Painter) => {
  p.stopped = true
  p.pending.clear()
  p.batch = []
}

const pictureAt = async ($: EngineInterface, file: string): Promise<Diagram> => {
  const png = await $.fs.read(file, { as: 'bytes' }).then(r => r.base64, () => '')
  const size = png ? pngSize(png) : null
  return size ? { file, ...size, ...(inlinable(png) ? { png } : {}) } : { error: true }
}

const renderDiagrams = async ($: EngineInterface, engine: Mermaid, theme: Style['theme'], sources: readonly string[]): Promise<Diagram[]> => {
  const batch = crypto.randomUUID().slice(0, 8)
  const input = `${engine.dir}/${batch}.md`
  const config = `${engine.dir}/${batch}.json`
  await $.fs.write(config, JSON.stringify(mermaidConfig(theme)))
  await $.fs.write(input, batchMarkdown(sources))
  const argv = ['mmdc', '-q', '-i', input, '-o', `${engine.dir}/${batch}.png`, '-c', config, '-b', 'transparent', '-s', String(MMDC_SCALE), '-j', '1', ...(engine.puppeteer ? ['-p', engine.puppeteer] : [])]
  const { exitCode } = await $.process.run(argv, { timeoutMs: Math.min(120000, 20000 + 5000 * sources.length) })
  const results = await Promise.all(sources.map((_, i) => pictureAt($, batchOutput(engine.dir, batch, i))))
  if (exitCode === 0 || sources.length === 1) return results
  const retried: Diagram[] = []
  for (const [i, result] of results.entries()) retried.push('error' in result ? (await renderDiagrams($, engine, theme, [sources[i]!]))[0]! : result)
  return retried
}

type Headings = { dir: string; font: string; magick: string }

const GHOSTTY_APP = '/Applications/Ghostty.app/Contents/MacOS/ghostty'

const terminalFont = async ($: EngineInterface): Promise<string | null> => {
  const terminal = await detectTerminal($)
  if (terminal === 'kitty') {
    const result = await $.process.run(['kitty', '+runpy', KITTY_FONT], { timeoutMs: 10000 }).catch(() => null)
    const name = result?.exitCode === 0 ? result.stdout.trim() : ''
    return name && name !== 'monospace' ? name : null
  }
  if (terminal !== 'ghostty') return null
  for (const ghostty of ['ghostty', GHOSTTY_APP]) {
    const result = await $.process.run([ghostty, '+show-config'], { timeoutMs: 10000 }).catch(() => null)
    if (result?.exitCode === 0) return ghosttyFont(result.stdout)
  }
  return null
}

const imageMagick = async ($: EngineInterface): Promise<string | null> => {
  for (const command of ['magick', 'convert']) {
    const result = await $.process.run([command, '-version'], { timeoutMs: 10000 }).catch(() => null)
    if (result?.exitCode === 0 && result.stdout.includes('ImageMagick')) return command
  }
  return null
}

const fontFile = async ($: EngineInterface, family: string | null): Promise<string | null> => {
  for (const pattern of [...(family ? [`${family}:bold`] : []), 'monospace:bold']) {
    const result = await $.process.run(['fc-match', '-f', '%{file}', pattern], { timeoutMs: 5000 }).catch(() => null)
    const file = result?.exitCode === 0 ? result.stdout.trim() : ''
    if (file) return file
  }
  return null
}

const startHeadings = async ($: EngineInterface, style: Style): Promise<Headings | null> => {
  if (!style.headingImages || !(await drawsImages($))) return null
  const magick = await imageMagick($)
  if (!magick) return null
  const font = await fontFile($, await terminalFont($))
  if (!font) return null
  const dir = await workDir($, 'headings')
  await $.fs.write(`${dir}/.ocellus`, '')
  return { dir, font, magick }
}

const renderHeadings = async ($: EngineInterface, engine: Headings, sources: readonly string[]): Promise<Diagram[]> => {
  const results: Diagram[] = []
  for (const source of sources) {
    const heading = parseHeadingSource(source)
    const file = `${engine.dir}/${crypto.randomUUID().slice(0, 8)}.png`
    const argv = [engine.magick, '-background', 'none', '-fill', heading.color, '-font', engine.font, '-pointsize', String(HEADING_PX_PER_ROW * headingRows(heading.level)), `label:${labelText(heading.lines)}`, file]
    const { exitCode } = await $.process.run(argv, { timeoutMs: 10000 })
    results.push(exitCode === 0 ? await pictureAt($, file) : { error: true })
  }
  return results
}

const paintLater = async ($: EngineInterface, p: Painter, items: Job[]): Promise<void> => {
  const engine = await painterEngine($, p)
  if (!engine || p.stopped) return
  const sources = items.map(item => item.source)
  const results = await (p.kind === 'mermaid' ? renderDiagrams($, engine as Mermaid, p.style.theme, sources) : renderHeadings($, engine as Headings, sources)).catch(() => null)
  if (!results) return stopPainter(p)
  const fresh = items.map((item, i) => [item.key, results[i]!] as const)
  const keep = (store: Record<string, unknown>) => keepFormulas(store, fresh, p.wanted, p.limit)
  await (p.kind === 'mermaid' ? update($, diagrams, keep) : update($, headings, keep))
  p.wanted.clear()
  for (const item of items) p.pending.delete(item.key)
}

const picturesOf = async ($: EngineInterface, p: Painter, found: (Job & { i: number })[]): Promise<Map<number, Picture>> => {
  if (found.length === 0) return new Map()
  void painterEngine($, p)
  if (!p.ready) return new Map()
  for (const { key } of found) p.wanted.add(key)
  const store = (p.kind === 'mermaid' ? await read($, diagrams) : await read($, headings)) as Record<string, Diagram>
  const missing = p.stopped ? [] : [...new Map(found.map(({ key, source }) => [key, source]))].filter(([key]) => !store[key] && !p.pending.has(key))
  if (missing.length) {
    if (p.batch.length === 0) {
      $.clock.after(0, () => {
        const items = p.batch
        p.batch = []
        p.queue = p.queue.then(() => paintLater($, p, items)).catch(() => stopPainter(p))
      })
    }
    for (const [key, source] of missing) {
      p.pending.add(key)
      p.batch.push({ key, source })
    }
  }
  return new Map(found.flatMap(({ i, key }) => {
    const picture = store[key]
    return picture && !('error' in picture) ? [[i, picture] as const] : []
  }))
}

const diagramsOfBlocks = async ($: EngineInterface, mermaid: MermaidSession, surface: string, blocks: Block[]): Promise<Map<number, Picture>> => {
  if (surface !== 'terminal' || !mermaid.style.mermaidImages) return new Map()
  const themeKey = themeKeyOf(mermaid.style.theme)
  return picturesOf($, mermaid, [...blocks.entries()].flatMap(([i, block]) => {
    const source = mermaidOf(block)
    return source === null ? [] : [{ i, source, key: diagramKey(themeKey, source) }]
  }))
}

const headingsOfBlocks = async ($: EngineInterface, headed: Painter, surface: string, blocks: Block[], columns: number): Promise<Map<number, Picture & { heading: HeadingSource }>> => {
  const style = headed.style
  if (surface !== 'terminal' || !style.headingImages) return new Map()
  const found = blocks.flatMap((block, i) => {
    const rows = block.kind === 'heading' ? headingRows(block.level) : 0
    if (block.kind !== 'heading' || !rows || i === blocks.length - 1) return []
    const text = inlineText(block.inline).trim()
    if (!text || hasRtl(text)) return []
    const heading = { level: block.level, color: colorHex(headingColor(style.theme, block.level), '#808080'), lines: wrapHeading(style.headingStyle === 'uppercase' && block.level === 1 ? text.toUpperCase() : text, Math.max(4, Math.floor(columns / rows))) }
    const source = headingSource(heading)
    return [{ i, source, key: source, heading }]
  })
  const pictures = await picturesOf($, headed, found)
  return new Map(found.flatMap(({ i, heading }) => {
    const picture = pictures.get(i)
    return picture ? [[i, { ...picture, heading }] as const] : []
  }))
}

const ZOOM_SCALE = 4
const ZOOM_VIEW = `kitty +kitten icat --scale-up --align center "$1"; printf '\\n  [Enter to close] '; read -r _`

type ZoomTarget = { kind: 'mermaid'; source: string } | { kind: 'image'; id: number }

const zoomable = {
  targets: new Map<string, ZoomTarget>(),
  session: undefined as MermaidSession | undefined,
  add(target: ZoomTarget): string {
    const id = target.kind === 'mermaid' ? hashOf(target.source) : `image-${target.id}`
    this.targets.delete(id)
    this.targets.set(id, target)
    if (this.targets.size > 200) this.targets.delete(this.targets.keys().next().value!)
    return id
  },
}

type Preview = Picture & PastedSource
const pastes = { images: new Map<number, Preview | { error: true }>(), loading: false, triedAt: -Infinity, dir: '' }

const pasteDir = async ($: EngineInterface): Promise<string> => {
  if (pastes.dir) return pastes.dir
  const dir = await workDir($, 'paste')
  await $.fs.write(`${dir}/.ocellus`, '')
  pastes.dir = dir
  return dir
}

const DECODE = '{ base64 -d < "$1" 2>/dev/null || base64 -D < "$1"; } > "$2.raw" || exit 1; if [ "$3" = png ]; then mv "$2.raw" "$2"; else im=$(command -v magick || command -v convert) && "$im" "$2.raw" "png:$2"; fi'

const pasteFile = async ($: EngineInterface, id: number, source: PastedSource): Promise<string | null> => {
  const file = `${await pasteDir($)}/image-${id}.png`
  await $.fs.write(`${file}.b64`, source.data)
  const kind = source.mediaType === 'image/png' ? 'png' : 'other'
  const result = await $.process.run(['sh', '-c', DECODE, 'paste', `${file}.b64`, file, kind], { timeoutMs: 20000 }).catch(() => null)
  return result?.exitCode === 0 ? file : null
}

const previewOf = async ($: EngineInterface, id: number, source: PastedSource): Promise<Preview | { error: true }> => {
  const size = source.mediaType === 'image/png' ? pngSize(source.data) : null
  if (size && inlinable(source.data)) return { png: source.data, file: '', ...size, ...source }
  const file = await pasteFile($, id, source)
  const png = file ? await $.fs.read(file, { as: 'bytes' }).then(r => r.base64, () => '') : ''
  const read = png ? pngSize(png) : null
  return file && read ? { file, ...read, ...(inlinable(png) ? { png } : {}), ...source } : { error: true }
}

const loadPastes = async ($: EngineInterface): Promise<void> => {
  const messages = await $.session.messages({ as: 'api' })
  let added = false
  for (const [id, source] of pastedImages(messages)) {
    if (pastes.images.has(id)) continue
    pastes.images.set(id, await previewOf($, id, source))
    added = true
  }
  if (added) $.ui.invalidate('ui.render')
}

const previewsOf = async ($: EngineInterface, text: string): Promise<{ id: number; preview: Preview }[]> => {
  const ids = imageRefs(text)
  if (ids.length === 0) return []
  const now = await $.clock.now()
  if (ids.some(id => !pastes.images.has(id)) && !pastes.loading && now - pastes.triedAt > 1000) {
    pastes.loading = true
    pastes.triedAt = now
    $.clock.after(0, () => void loadPastes($).catch(() => undefined).finally(() => (pastes.loading = false)))
  }
  return ids.flatMap(id => {
    const preview = pastes.images.get(id)
    return preview && !('error' in preview) ? [{ id, preview }] : []
  })
}

const zoomFile = async ($: EngineInterface, target: ZoomTarget): Promise<{ file: string } | { failure: string }> => {
  if (target.kind === 'image') {
    const preview = pastes.images.get(target.id)
    if (!preview || 'error' in preview) return { failure: 'That image is gone' }
    const file = preview.file || (await pasteFile($, target.id, preview))
    return file ? { file } : { failure: 'Could not write the image' }
  }
  const mermaid = zoomable.session
  const engine = mermaid ? ((await painterEngine($, mermaid)) as Mermaid | null) : null
  if (!mermaid || !engine) return { failure: 'mmdc is not available' }
  const name = `${engine.dir}/zoom-${crypto.randomUUID().slice(0, 8)}`
  await $.fs.write(`${name}.json`, JSON.stringify(mermaidConfig(mermaid.style.theme)))
  await $.fs.write(`${name}.mmd`, target.source)
  const render = await $.process.run(['mmdc', '-q', '-i', `${name}.mmd`, '-o', `${name}.png`, '-c', `${name}.json`, '-b', 'transparent', '-s', String(ZOOM_SCALE), '-j', '1', ...(engine.puppeteer ? ['-p', engine.puppeteer] : [])], { timeoutMs: 60000 })
  return render.exitCode === 0 ? { file: `${name}.png` } : { failure: `mmdc failed: ${render.stderr.trim().split('\n')[0] ?? render.exitCode}` }
}

const zoomIn = async ($: EngineInterface, target: ZoomTarget): Promise<string | null> => {
  const window = await $.env.get('KITTY_WINDOW_ID')
  if (!window) return 'Full screen needs kitty'
  const shown = await zoomFile($, target)
  if ('failure' in shown) return shown.failure
  const launch = await $.process.run(['kitty', '@', 'launch', '--match', `window_id:${window}`, '--next-to', `id:${window}`, '--type=overlay', `--title=${target.kind === 'image' ? 'image' : 'diagram'}`, '--', 'sh', '-c', ZOOM_VIEW, 'zoom', shown.file], { timeoutMs: 10000 })
  return launch.exitCode === 0 ? null : `kitty refused the overlay: ${launch.stderr.trim().split('\n')[0] ?? launch.exitCode}`
}

const openZoom = async ($: EngineInterface, id: string): Promise<void> => {
  const target = zoomable.targets.get(id)
  if (!target) return
  $.ui.toast(target.kind === 'image' ? 'Opening the image full screen…' : 'Opening the diagram full screen…')
  const failure = await zoomIn($, target).catch(() => 'Could not open it')
  if (failure) $.ui.toast(failure)
}

const zoomBox = (el: ReturnType<EngineInterface['ui']['resolve']>, style: Style, image: RenderElement, id: string, fit: { columns: number; rows: number }, key: string): RenderElement =>
  'Client' in el && style.zoom ? (
    <el.Box key={key} width={fit.columns} height={fit.rows}>
      {image}
      <el.Box position="absolute" top={0} left={0}>
        <el.Client key={`zoom-${id}`} module="./zoom.tsx" props={{ id, columns: fit.columns, rows: fit.rows }} width={fit.columns} height={fit.rows} />
      </el.Box>
    </el.Box>
  ) : image

const drawPreviews = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, style: Style, previews: { id: number; preview: Preview }[], columns: number): RenderElement | null => {
  const Image = 'Image' in el ? el.Image : null
  if (!Image || previews.length === 0) return null
  const shown = previews.flatMap(({ id, preview }) => {
    const fit = fitPreview(preview, columns - 2)
    if (!fit) return []
    const image = <Image key={`img${id}`} source={preview.png ? { png: preview.png } : { file: preview.file, format: 'png' }} columns={fit.columns} rows={fit.rows} alt={`[Image #${id}]`} />
    return [zoomBox(el, style, image, zoomable.add({ kind: 'image', id }), fit, `paste${id}`)]
  })
  return shown.length ? <el.Box key="pasted" flexDirection="column" rowGap={1} paddingLeft={2}>{shown}</el.Box> : null
}

const locate = async ($: EngineInterface, style: Style) => {
  style.cwd = await $.session.root().catch(() => style.cwd)
  style.home ||= (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
}

const htmlBackend = async ($: EngineInterface): Promise<ClipboardBackend | null> => {
  if (await $.env.get('SSH_CONNECTION') || await $.env.get('SSH_TTY')) return null
  const helper = await $.fs.stat('/usr/bin/osascript').catch(() => null)
  if (helper?.kind === 'file') return 'macos'
  return await $.env.get('WAYLAND_DISPLAY') || await $.env.get('DISPLAY') ? 'linux' : null
}

const zoomBackend = async ($: EngineInterface): Promise<boolean> =>
  !!(await $.env.get('KITTY_WINDOW_ID')) && !(await $.env.get('TMUX')) && !(await $.env.get('SSH_CONNECTION')) && !(await $.env.get('SSH_TTY'))

type Probes = { detected?: Promise<Terminal | null>; terminal?: Promise<Terminal | null>; htmlCopy?: Promise<ClipboardBackend | null>; zoom?: Promise<boolean>; images?: Promise<boolean> }

const probe = async ($: EngineInterface, style: Style, probes: Probes): Promise<Terminal | null> => {
  probes.detected ??= detectTerminal($)
  const detected = await probes.detected
  probes.terminal ??= Promise.resolve(applyRtl(style, detected))
  const terminal = await probes.terminal
  probes.htmlCopy ??= htmlBackend($)
  style.htmlCopy = await probes.htmlCopy
  probes.zoom ??= zoomBackend($)
  style.zoom = await probes.zoom
  probes.images ??= $.env.get('TMUX').then(tmux => !tmux && (detected === 'kitty' || detected === 'ghostty'))
  style.images = await probes.images
  return terminal
}

const copyTable = async ($: EngineInterface, backend: ClipboardBackend, html: string, text: string): Promise<string | null> => {
  const command = clipboardCommand(backend, html, text)
  const result = await $.process.run(command.argv, { stdin: command.stdin, timeoutMs: 5000 }).catch(() => null)
  if (!result) return command.failure
  return result.exitCode === 0 ? null : result.stderr.trim() || command.failure
}

const folder = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, open?: string[]): Fold => (id, hidden, key) => {
  if (!open) return null
  const folded = !open.includes(id)
  return { folded, element: <el.Button key={key} variant="secondary" label={folded ? `+${hidden} more lines` : 'show less'} onPress={() => update($, unfolded, ids => (folded ? [...ids, id].slice(-500) : ids.filter(x => x !== id)))} /> }
}

const drawMarkdown = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, style: Style, blocks: ReturnType<typeof parse>, columns: number, math: Map<number, Typeset> = new Map(), reply?: string, open?: string[], pictures: Map<number, Picture> = new Map(), titles: Map<number, Picture & { heading: HeadingSource }> = new Map()): RenderElement[] => {
  const { Button } = el
  const copy = (text: string | (() => string), key: string, label = '⧉ copy', html?: () => string) => {
    const copied = async (surface: RenderSurface): Promise<string> => {
      const content = typeof text === 'function' ? text() : text
      const backend = style.htmlCopy
      const failure = html && backend ? await copyTable($, backend, html(), content) : undefined
      if (failure === null) return 'Copied formatted table'
      const result = await $.ui.copy({ text: content, surface })
      if (!result.isCopied) return `Copy failed: ${result.reason}`
      return failure ? `Copied as plain text (${failure})` : 'Copied'
    }
    return style.copyButtons && (!html || style.htmlCopy) ? (
      <Button
        key={key}
        variant="primary"
        label={label}
        onPress={async press => $.ui.toast(await copied(press.surface).catch(() => 'Copy failed'))}
      />
    ) : null
  }
  const drawn: Drawn = new Map()
  const Image = 'Image' in el ? el.Image : null
  if (style.mermaid) {
    for (const [i, block] of blocks.entries()) {
      if (block.kind !== 'code' || block.lang.toLowerCase() !== 'mermaid') continue
      const source = block.lines.join('\n')
      const picture = Image ? pictures.get(i) : undefined
      const fit = picture ? fitDiagram(picture, columns) : null
      if (Image && picture && fit) {
        const alt = `mermaid: ${source.trim().split('\n')[0]!.trim()}`
        const id = zoomable.add({ kind: 'mermaid', source })
        const image = <Image key={`img${i}`} source={picture.png ? { png: picture.png } : { file: picture.file, format: 'png' }} columns={fit.columns} rows={fit.rows} alt={alt} />
        const element = <el.Box key={`b${i}`} paddingLeft={2}>{zoomBox(el, style, image, id, fit, `zoom${i}`)}</el.Box>
        const button = style.zoom ? <el.Button key={`zoombtn${i}`} variant="primary" label="⤢ zoom" onPress={() => void openZoom($, id)} /> : undefined
        drawn.set(i, { element, button })
        continue
      }
      let narrowest = Infinity
      for (const max of [Infinity, 24, 12]) {
        const art = mermaidText(max === Infinity ? source : shortenEdgeLabels(source, max), style.mermaidAscii, columns)
        const wide = art === null ? Infinity : Math.max(...art.split('\n').map(width))
        narrowest = Math.min(narrowest, wide)
        if (art === null || wide > columns - 2) continue
        drawn.set(i, { element: boxArt(el, style, art, `b${i}`, inlineMarks(source)), art })
        break
      }
      if (!drawn.has(i) && !block.isOpen) {
        const kind = unsupportedKind(source)
        drawn.set(i, { note: kind ? `${kind} diagrams draw as source for now` : narrowest === Infinity ? 'diagram failed to render' : `diagram is ${narrowest} cols, terminal is ${columns}` })
      }
    }
  }
  if (Image) {
    for (const [i, title] of titles) {
      const fit = fitHeading(title, title.heading, columns)
      if (!fit) continue
      const image = <Image key={`b${i}`} source={title.png ? { png: title.png } : { file: title.file, format: 'png' }} columns={fit.columns} rows={fit.rows} alt={title.heading.lines.join(' ')} />
      const rule = title.heading.level === 2 && style.headingStyle === 'banner' ? <el.Text key="rule" color={title.heading.color}>{'━'.repeat(fit.columns)}</el.Text> : null
      drawn.set(i, { element: rule ? <el.Box key={`b${i}`} flexDirection="column" alignSelf="flex-start">{image}{rule}</el.Box> : image })
    }
    for (const [i, formula] of math) {
      const picked = pickFormula(formula, columns)
      if (picked) drawn.set(i, { element: <Image key={`b${i}`} source={{ png: picked.picture.png }} columns={picked.fit.columns} rows={picked.fit.rows} alt={formula.tex} /> })
    }
  }
  for (const [i, block] of blocks.entries()) {
    const tex = drawn.has(i) ? null : mathOf(block)
    const text = tex === null ? null : texText(tex)
    if (text && !text.includes('\\')) drawn.set(i, { element: <el.Box key={`b${i}`} paddingLeft={2}><el.Text italic color={style.theme.emphasis}>{text}</el.Text></el.Box> })
  }
  const elements = renderBlocks(el, style, blocks, columns, drawn, copy, folder($, el, open))
  const button = reply === undefined ? null : copy(reply, 'reply', '⧉ copy reply')
  return button ? [...elements, <el.Box key="reply" alignSelf="flex-end">{button}</el.Box>] : elements
}

export const register: Register = (on, options) => {
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), ocellus: { markdown: async () => undefined } }))
  if (options.enabled === false) return
  let themeName = pickTheme(options.theme)
  const style = resolveStyle({ ...options, theme: themeName })
  const parsed = new Map<string, ReturnType<typeof parse>>()
  const parseCached = (text: string, cache = parsed, limit?: number) => remember(cache, text, () => parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }), limit)
  const shared = new Map<string, ReturnType<typeof parse>>()
  let terminal: Terminal | null = null
  const fit = (viewport?: { isFullscreen?: boolean }): Style => (terminal === 'apple-terminal' && viewport?.isFullscreen ? { ...style, shape: 'inverse' } : style)
  const mermaid: MermaidSession = painter(style, 'mermaid', MAX_DIAGRAMS)
  const headed = painter(style, 'headings', MAX_HEADINGS)
  zoomable.session = mermaid
  const latex: LatexSession = { style, color: ratexColor(style.theme.diagramText ?? style.theme.codeText ?? '#808080'), pending: new Set(), wanted: new Set(), batch: [], queue: Promise.resolve() }
  const forSurface = (base: Style, surface: RenderSurface): Style => (surface === 'terminal' || !base.htmlCopy ? base : { ...base, htmlCopy: null })
  const fullWidth = (text: string) => (style.reorder && hasRtl(text) ? { width: '100%' as const } : {})
  const probes: Probes = {}

  const quiet = style.toolOutput === 'quiet'
  if (options.toolRows !== false) {
    on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
      await locate($, style)
      if (quiet) for (const call of e.props.calls) if (call.tool_use_id && isReadOnlyCall(call.tool, call.input)) rememberCall(readOnlyCalls, call.tool_use_id)
      if (e.props.isExpanded) {
        for (const call of e.props.calls) if (call.tool_use_id) markExpanded(call.tool_use_id)
        return next(e)
      }
      return renderToolGroup($.ui.resolve(e), fit(e.viewport), e.props.calls, e.props.isActive, e.viewport?.columns)
    })
    on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
      await locate($, style)
      if (quiet && isReadOnlyCall(e.props.tool, e.props.input)) rememberCall(readOnlyCalls, e.props.tool_use_id)
      if (!expandedCalls.has(e.props.tool_use_id)) return renderToolRow($.ui.resolve(e), fit(e.viewport), e.props, e.viewport?.columns)
      return e.props.tool === 'Bash' || e.props.tool === 'PowerShell' ? renderExpandedShell($.ui.resolve(e), fit(e.viewport), e.props) : next(e)
    })
    on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
      if ((e.props.tool === 'Edit' || e.props.tool === 'Write') && !e.props.isErrored) {
        const el = $.ui.resolve(e)
        return renderDiffCard(el, fit(e.viewport), e.props.output, folder($, el, await read($, unfolded)), e.props.tool_use_id) ?? next(e)
      }
      if (!quiet) return next(e)
      await locate($, style)
      const el = $.ui.resolve(e)
      const shell = e.props.tool === 'Bash' || e.props.tool === 'PowerShell'
      const out = (e.props.output ?? {}) as Record<string, unknown>
      if (shell && (out.backgroundTaskId || out.isImage || out.interrupted)) return next(e)
      if (e.props.isErrored) return renderFailure(el, fit(e.viewport), e.props.output) ?? next(e)
      if (readOnlyCalls.has(e.props.tool_use_id)) return <el.Box />
      return shell ? renderShellResult(el, fit(e.viewport), e.props.output) : next(e)
    })
  }

  on('session.start', async ($, e, next) => {
    terminal = await probe($, style, probes)
    void latexEngine($, latex)
    void painterEngine($, mermaid)
    void painterEngine($, headed)
    const started = await next(e)
    await $.command
      .register({ name: 'ocellus', description: 'Switch the ocellus theme, copy the last reply, show the demo, or check dependencies', argumentHint: '[theme [<name> | random] | copy [code] | demo | doctor]' })
      .catch(() => undefined)
    return started
  })

  on('command.run', { command: 'ocellus' }, async ($, e) => {
    const [first, second] = e.args.trim().split(/\s+/)
    const themeArgs = [...PRESET_NAMES, 'random']
    const [sub, name] = themeArgs.includes(first ?? '') ? ['theme', first] : [first, second]
    if (sub === 'demo') return { text: showcaseText(PRESET_NAMES) }
    if (sub === 'doctor') return { text: doctorText(await doctorFacts($, style)) }
    if (sub === 'copy') {
      const reply = (await $.session.messages()).findLast(m => m.role === 'assistant' && m.text.trim())
      if (!reply) return { text: 'Nothing to copy yet.' }
      const code = name === 'code' ? parseCached(reply.text).flatMap(b => (b.kind === 'list' ? b.items.flatMap(it => it.blocks ?? []) : [b])).findLast(b => b.kind === 'code') : undefined
      if (name === 'code' && code?.kind !== 'code') return { text: 'The last reply has no code block.' }
      const result = await $.ui.copy({ text: code?.kind === 'code' ? code.lines.join('\n') : reply.text })
      return { text: result.isCopied ? `Copied the last ${code ? 'code block' : 'reply'}.` : `Copy failed: ${result.reason}` }
    }
    if (sub === 'demo-rtl') {
      terminal = await probe($, style, probes)
      return { text: rtlShowcaseText() }
    }
    if (sub !== 'theme') return { text: helpText(PRESET_NAMES) }
    if (!name) return { text: options.theme === 'random' ? `current: ${themeName} (random)\nkeep it: /ocellus theme ${themeName}` : `current: ${themeName}` }
    if (!themeArgs.includes(name)) return { text: `Unknown theme "${name}". Themes: ${PRESET_NAMES.join(', ')}, random` }
    const result = await $.config.set({ key: `${$.plugin.name}.theme`, value: name })
    if (result.deny) return { text: `Could not switch theme: ${result.deny}` }
    if (name !== 'random' || options.theme !== 'random') return { text: `Theme set to ${name}.` }
    const others = RANDOM_THEMES.filter(t => t !== themeName)
    themeName = others[Math.floor(Math.random() * others.length)]!
    Object.assign(style, resolveStyle({ ...options, theme: themeName }))
    $.ui.invalidate('ui.render')
    return { text: `Theme set to random: ${themeName} for now.\nkeep it: /ocellus theme ${themeName}` }
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const at = style.clock === 'off' ? undefined : endedAt(await read($, turnEnds), e.props.durationMs, await firstDrawn($, e.requestId))
    const time = at === undefined ? undefined : clockText(at, await $.clock.now(), style.clock)
    return renderTurnDuration($.ui.resolve(e), style, e.props.word, e.props.durationMs, time)
  })

  on('turn.complete', async ($, e, next) => {
    if (style.clock !== 'off' && e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, turnEnds, list => withRecord(list, { durationMs: e.durationMs, at }))
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (style.clock !== 'off' && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')) {
      const at = await $.clock.now()
      await update($, sent, list => withRecord(list, { text: promptKey(e.text), at }))
    }
    terminal = await probe($, style, probes)
    if (!style.diagramHints || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    void latexEngine($, latex)
    void painterEngine($, mermaid)
    const hints = [HINT, ...(mermaid.ready && !mermaid.stopped ? [MERMAID_HINT] : []), ...(latex.ready && !latex.stopped ? [LATEX_HINT] : [])]
    return next({ ...e, context: [...(e.context ?? []), ...hints] })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    if (e.props.text.includes('\u001b')) return next(e)
    const blocks = parseCached(e.props.text)
    if (blocks.length === 0) return next(e)
    const el = $.ui.resolve(e)
    const { Box } = el
    const math = await mathOfBlocks($, latex, e.surface, blocks)
    const pictures = await diagramsOfBlocks($, mermaid, e.surface, blocks)
    const titles = await headingsOfBlocks($, headed, e.surface, blocks, columnsOf(e.viewport))
    const open = await read($, unfolded)
    return <Box flexDirection="column" rowGap={1} {...fullWidth(e.props.text)}>{drawMarkdown($, el, forSurface(fit(e.viewport), e.surface), blocks, columnsOf(e.viewport), math, undefined, open, pictures, titles)}</Box>
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const kind = e.props.origin.kind
    const own = kind === 'composer' || kind === 'bridge' || (kind === 'unclassified' && !e.props.from && !e.props.task)
    if (!own) return next(e)
    const at = style.clock === 'off' ? undefined : sentAt(await read($, sent), e.props.text, await firstDrawn($, e.requestId))
    const time = at === undefined ? undefined : clockText(at, await $.clock.now(), style.clock)
    const prompt = style.promptStyle === 'off'
      ? await (time === undefined ? next(e) : next({ ...e, props: { ...e.props, text: `[${time}] ${e.props.text}` } }))
      : renderUserPrompt($.ui.resolve(e), fit(e.viewport), e.props.text, columnsOf(e.viewport), time)
    const el = $.ui.resolve(e)
    const pasted = e.surface === 'terminal' && style.images ? drawPreviews($, el, style, await previewsOf($, e.props.text), columnsOf(e.viewport)) : null
    return pasted ? <el.Box flexDirection="column" rowGap={1}>{prompt}{pasted}</el.Box> : prompt
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const blocks = parseCached(e.props.text)
    if (blocks.length === 0) return next(e)
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const narration = style.toolStyle === 'tree-bold' && blocks.length === 1 && blocks[0]!.kind === 'paragraph'
    const math = await mathOfBlocks($, latex, e.surface, blocks)
    const pictures = await diagramsOfBlocks($, mermaid, e.surface, blocks)
    const titles = await headingsOfBlocks($, headed, e.surface, blocks, columnsOf(e.viewport))
    const surfaceStyle = forSurface(fit(e.viewport), e.surface)
    const open = await read($, unfolded)
    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={style.theme.accent}>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        <Box flexDirection="column" rowGap={1} flexGrow={1}>
          {drawMarkdown($, el, narration ? { ...surfaceStyle, narration } : surfaceStyle, blocks, columnsOf(e.viewport), math, blocks.length > 1 || hasRtl(e.props.text) ? e.props.text : undefined, open, pictures, titles)}
        </Box>
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as { zoom?: unknown } | null
    if (!data || typeof data !== 'object' || typeof data.zoom !== 'string') return next(e)
    void openZoom($, data.zoom)
    return {}
  })

  on('ocellus.markdown', ($, e, next) => {
    const blocks = parseCached(e.text, shared, 20)
    if (blocks.length === 0) return next(e)
    const el = $.ui.resolve({ surface: e.surface, component: 'AssistantMessage' })
    const { Box } = el
    return { value: <Box flexDirection="column" rowGap={1} {...fullWidth(e.text)}>{drawMarkdown($, el, { ...style, copyButtons: false }, blocks, Math.max(20, e.columns || 0))}</Box> }
  })
}
