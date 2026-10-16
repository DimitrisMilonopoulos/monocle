import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fitDiagram, mermaidConfig } from '../hooks/diagram'
import { PRESETS } from '../hooks/presets'

const PNG_800x400 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQAQAAAAB+XjmZAAAAPklEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4NndAAAYtfwy0AAAAASUVORK5CYII='

const KITTY = { TERM: 'xterm-kitty', TMPDIR: '/tmp/', HOME: '/home/me' }
const FLOW = '```mermaid\ngraph LR\n  A[Start] --> B[Done]\n```'
const PIE = '```mermaid\npie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n```'
const BAD = '```mermaid\ngraph LR\n  A --> \n```'

type Run = { argv: readonly string[]; sources: string[] }

const base = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path

const mmdc = (on: On, { installed = true, broken = (_: string): boolean => false }: { installed?: boolean; broken?: (source: string) => boolean } = {}) => {
  const runs: Run[] = []
  const kitty: (readonly string[])[] = []
  const written = new Map<string, string>()
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', (_, e) => ({ value: e.path.replace(/\\/g, '/').endsWith('/usr/bin/chromium') }))
  on('fs.write', (_, e) => {
    written.set(base(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'kitty') {
      kitty.push(e.argv)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] !== 'mmdc' || !installed) return { deny: `spawn ${e.argv[0]} ENOENT` }
    const input = e.argv[e.argv.indexOf('-i') + 1]
    const sources = input ? [...(written.get(base(input)) ?? '').matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map(m => m[1]!) : []
    if (e.argv.includes('-i')) runs.push({ argv: e.argv, sources })
    const failed = sources.some(broken)
    return { value: { exitCode: failed ? 1 : 0, stdout: '', stderr: failed ? 'Parse error' : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => {
    const match = /^([0-9a-f]{8})-(\d+)\.png$/.exec(base(e.path))
    const run = match ? runs.find(r => r.argv.some(a => base(a) === `${match[1]}.png`)) : undefined
    if (/^zoom-[0-9a-f]{8}\.png$/.test(base(e.path))) return { value: { base64: PNG_800x400 } }
    const source = match && run ? run.sources[Number(match[2]) - 1] : undefined
    if (source === undefined) return { deny: `no such file ${e.path}` }
    if (broken(source)) return { deny: `no such file ${e.path}` }
    return { value: { base64: PNG_800x400 } }
  })
  return { runs, written, kitty }
}

const reply = (text: string, columns = 120) => ({
  plugin: 'monocle',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const hints = (on: On) => {
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  return seen
}

test('a mermaid block draws as an image rendered by mmdc in the theme colors', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs, written } = mmdc(on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  const image = await ui.find({ type: 'Image' })
  expect(image?.props.alt).toBe('mermaid: graph LR')
  expect(runs).toHaveLength(1)
  expect(runs[0]!.argv).toEqual(expect.arrayContaining(['-b', 'transparent', '-s', '2', '-p']))
  expect(runs[0]!.sources).toEqual(['graph LR\n  A[Start] --> B[Done]'])
  const config = [...written].find(([name]) => name.endsWith('.json') && name !== 'puppeteer.json')?.[1]
  expect(JSON.parse(config ?? '{}').themeVariables.lineColor).toBe(PRESETS['catppuccin-mocha'].diagram)
  expect(JSON.parse(written.get('puppeteer.json') ?? '{}')).toEqual({ executablePath: '/usr/bin/chromium' })
  await ui.unmount()
})

test('a diagram the text art cannot draw still renders as an image', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  mmdc(on)

  const ui = await $.ui.mount(reply(PIE))
  await clock.settle()

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('mermaid: pie title Pets')
  await ui.unmount()
})

test('diagrams in one reply render in one mmdc run', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(`${FLOW}\n\nand\n\n${PIE}`))
  await clock.settle()

  expect(runs).toHaveLength(1)
  expect(runs[0]!.sources).toHaveLength(2)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  await ui.unmount()
})

test('a broken diagram falls back to its source while the good one in the batch still renders', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on, { broken: source => source.trim().endsWith('-->') })

  const ui = await $.ui.mount(reply(`${PIE}\n\nthen\n\n${BAD}`))
  await clock.settle()

  const images = await ui.findAll({ type: 'Image' })
  expect(images.map(i => i.props.alt)).toEqual(['mermaid: pie title Pets'])
  expect(runs.length).toBeGreaterThan(1)
  await ui.unmount()
})

test('without mmdc, diagrams stay text art and no mermaid image hint is sent', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  mmdc(on, { installed: false })
  const seen = hints(on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()
  await $.prompt.submit({ text: 'draw it', wait: false, origin: { kind: 'composer' } })

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Start/ })).toBeDefined()
  expect(seen[0]?.some(c => c.includes('pie, gantt'))).toBe(false)
  await ui.unmount()
})

test('with mmdc working, the prompt hint says every mermaid type renders', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  mmdc(on)
  on('session.start', () => ({ cwd: '/tmp' }))
  const seen = hints(on)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.prompt.submit({ text: 'draw it', wait: false, origin: { kind: 'composer' } })

  expect(seen[0]?.some(c => c.includes('pie, gantt'))).toBe(true)
})

test('mermaidImages off never runs mmdc', { options: { mermaidImages: false } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  let ran = 0
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('process.run', () => {
    ran++
    return { deny: 'not expected' }
  })

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(ran).toBe(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a terminal built on libghostty counts as Ghostty by its terminfo name', async ($, on) => {
  mock.env(on, { TERM: 'xterm-ghostty', TERM_PROGRAM: 'cmux', TMPDIR: '/tmp/', HOME: '/home/me' })
  const clock = mock.clock(on)
  mmdc(on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('under tmux, diagrams stay text art', async ($, on) => {
  mock.env(on, { ...KITTY, TMUX: '/tmp/tmux-1/default,1,0' })
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a diagram keeps its aspect and fits the columns', async () => {
  const wide = fitDiagram({ width: 3000, height: 400 }, 100)!
  expect(wide.columns).toBeLessThanOrEqual(98)
  expect(Math.abs(wide.columns / wide.rows - 3000 / 400 / 0.46)).toBeLessThan(3)

  expect(fitDiagram({ width: 8000, height: 400 }, 100)).toBeNull()

  const small = fitDiagram({ width: 400, height: 220 }, 100)!
  expect(small).toEqual({ rows: 5, columns: Math.round((400 / 220 / 0.46) * 5) })

  expect(fitDiagram({ width: 400, height: 400 }, 6)).toBeNull()
})

test('a diagram that would shrink below half its size stays text art', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  mmdc(on)

  const ui = await $.ui.mount(reply(FLOW, 24))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

const KITTY_WINDOW = { ...KITTY, KITTY_WINDOW_ID: '42' }

const started = async ($: Engine, on: On) => {
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

test('in kitty a drawn diagram gets a zoom button and a click target over the image', async ($, on) => {
  mock.env(on, KITTY_WINDOW)
  const clock = mock.clock(on)
  mmdc(on)
  await started($, on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(await ui.find({ type: 'Button', text: /zoom/ })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})

test('the zoom button renders the diagram sharper and opens it in a kitty overlay over this window', async ($, on) => {
  mock.env(on, KITTY_WINDOW)
  const clock = mock.clock(on)
  const { written, kitty } = mmdc(on)
  await started($, on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()
  const button = await ui.find({ type: 'Button', text: /zoom/ })
  await ui.press({ key: String(button?.key) })
  await clock.settle()

  const zoomInput = [...written.keys()].find(name => name.endsWith('.mmd'))
  expect(written.get(zoomInput ?? '')).toBe('graph LR\n  A[Start] --> B[Done]')
  expect(kitty).toHaveLength(1)
  expect(kitty[0]).toEqual(expect.arrayContaining(['@', 'launch', '--type=overlay', '--match', 'window_id:42', '--next-to', 'id:42']))
  expect(base(String(kitty[0]!.at(-1)))).toBe(zoomInput!.replace(/\.mmd$/, '.png'))
  await ui.unmount()
})

test('a click on the image opens the same overlay', async ($, on) => {
  mock.env(on, KITTY_WINDOW)
  const clock = mock.clock(on)
  const { kitty } = mmdc(on)
  await started($, on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()
  const client = await ui.find({ type: 'Client' })
  await ui.pointer({ type: 'down', x: 3, y: 1, button: 'left', in: String(client?.key) })
  await ui.pointer({ type: 'up', x: 3, y: 1, button: 'left', in: String(client?.key) })
  await clock.settle()

  expect(kitty).toHaveLength(1)
  await ui.unmount()
})

test('the image under the click target draws again once the click target has loaded', async ($, on) => {
  mock.env(on, KITTY_WINDOW)
  const clock = mock.clock(on)
  mmdc(on)
  await started($, on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(String((await ui.find({ type: 'Image' }))?.key)).toMatch(/img\d+[0-9a-f]{8}$/)
  await ui.unmount()
})

const HERDR = { TERM: 'xterm-256color', TERM_PROGRAM: 'herdr', KITTY_PID: '42', KITTY_LISTEN_ON: 'unix:@kitty-42', TMPDIR: '/tmp/', HOME: '/home/me' }

test('in herdr, where Claude Code draws no images unless forced, diagrams stay text art', async ($, on) => {
  mock.env(on, HERDR)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('in herdr with images forced on, diagrams draw as images, without zoom', async ($, on) => {
  mock.env(on, { ...HERDR, CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const clock = mock.clock(on)
  const { kitty } = mmdc(on)
  await started($, on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /zoom/ })).toBeUndefined()
  expect(kitty).toHaveLength(0)
  await ui.unmount()
})

test('outside kitty there is no zoom', async ($, on) => {
  mock.env(on, { ...KITTY, TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' })
  const clock = mock.clock(on)
  mmdc(on)
  await started($, on)

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /zoom/ })).toBeUndefined()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('light themes render with dark mode off', async () => {
  expect((mermaidConfig(PRESETS['catppuccin-mocha']).themeVariables as { darkMode: boolean }).darkMode).toBe(true)
  expect((mermaidConfig(PRESETS['catppuccin-latte']).themeVariables as { darkMode: boolean }).darkMode).toBe(false)
})
