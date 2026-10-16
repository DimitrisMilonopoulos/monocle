import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ghosttyPalette, kittyPalette, paintTheme, usesNames } from '../hooks/palette'
import { PRESETS } from '../hooks/presets'

const PNG_800x400 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQAQAAAAB+XjmZAAAAPklEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4NndAAAYtfwy0AAAAASUVORK5CYII='
const KITTY = { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '42', TMPDIR: '/tmp/', HOME: '/home/me' }
const FLOW = '```mermaid\ngraph LR\n  A[Start] --> B[Done]\n```'

const kittyColors = (blue: string, foreground = '#d4be98', background = '#1d2021') =>
  [
    'active_border_color     #00ff00',
    `background              ${background}`,
    ...Array.from({ length: 16 }, (_, i) => `color${i}${' '.repeat(i < 10 ? 18 : 17)}${i === 4 || i === 12 ? blue : `#${String(i).padStart(2, '0').repeat(3)}`}`),
    'color16                 #000000',
    `foreground              ${foreground}`,
  ].join('\n')

const base = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path

const world = (on: On, colors: { current: string }) => {
  const kitty: (readonly string[])[] = []
  const configs: Record<string, unknown>[] = []
  const written = new Map<string, string>()
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', (_, e) => ({ value: e.path.replace(/\\/g, '/').endsWith('/usr/bin/chromium') }))
  on('fs.write', (_, e) => {
    written.set(base(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'kitty') {
      kitty.push(e.argv)
      return ok(e.argv.includes('get-colors') ? colors.current : '')
    }
    if (e.argv[0] !== 'mmdc') return { deny: `spawn ${e.argv[0]} ENOENT` }
    const config = e.argv[e.argv.indexOf('-c') + 1]
    if (config) configs.push(JSON.parse(written.get(base(config)) ?? '{}'))
    return ok()
  })
  on('fs.read', () => ({ value: { base64: PNG_800x400 } }))
  return { kitty, configs }
}

const reply = (text: string) => ({
  plugin: 'monocle',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40 },
  surface: 'terminal' as const,
})

const variables = (config: Record<string, unknown> | undefined) => (config?.themeVariables ?? {}) as Record<string, unknown>

test('kitty get-colors and ghostty show-config read as a palette', () => {
  const kitty = kittyPalette(kittyColors('#7daea3'))
  expect(kitty?.foreground).toBe('#d4be98')
  expect(kitty?.background).toBe('#1d2021')
  expect(kitty?.colors).toHaveLength(16)
  expect(kitty?.colors[4]).toBe('#7daea3')

  const ghostty = ghosttyPalette([
    'font-family = JetBrains Mono',
    ...Array.from({ length: 16 }, (_, i) => `palette = ${i}=#${String(i).padStart(2, '0').repeat(3)}`),
    'palette = 200=#123456',
    'background = 282c34',
    'foreground = #ABB2BF',
  ].join('\n'))
  expect(ghostty?.colors[15]).toBe('#151515')
  expect(ghostty?.background).toBe('#282c34')
  expect(ghostty?.foreground).toBe('#abb2bf')

  expect(kittyPalette('color0 #000000\nforeground #ffffff')).toBeNull()
})

test('the ansi theme names terminal colors, and images get them as hex from the palette', () => {
  const ansi = PRESETS.ansi
  expect(usesNames(ansi)).toBe(true)
  expect(usesNames({ number: 'cyan' })).toBe(false)
  expect(usesNames(PRESETS['catppuccin-mocha'])).toBe(false)
  const palette = kittyPalette(kittyColors('#7daea3'))!
  const painted = paintTheme(ansi, palette, true)
  expect(painted.diagram).toBe('#7daea3')
  expect(painted.codeComment).toBe(palette.colors[8])
  expect(painted.diagramText).toBe('#d4be98')
  expect(painted.rule).toBe('#3a3934')
  expect(paintTheme({ number: 'rainbow_blue', heading: '#fabd2f' }, palette, false)).toEqual({ number: palette.colors[6], heading: '#fabd2f' })
})

test('with theme ansi, text uses the Claude Code theme keys that follow the terminal', { options: { theme: 'ansi' } }, async $ => {
  const ui = await $.ui.mount(reply('| Blend | Cups |\n| --- | ---: |\n| Assam | 386 |'))
  expect((await ui.find({ type: 'Text', text: 'Blend' }))?.props.color).toBe('rainbow_yellow')
  await ui.unmount()
})

test('with theme ansi in kitty, diagrams take the colors of this kitty window', { options: { theme: 'ansi' } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const colors = { current: kittyColors('#7daea3') }
  const { kitty, configs } = world(on, colors)
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(kitty.find(argv => argv.includes('get-colors'))).toEqual(expect.arrayContaining(['@', 'get-colors', '--match', 'id:42']))
  expect(variables(configs.at(-1)).lineColor).toBe('#7daea3')
  expect(variables(configs.at(-1)).textColor).toBe('#d4be98')
  await ui.unmount()
})

test('a new terminal palette reaches the next diagrams after a prompt', { options: { theme: 'ansi' } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const colors = { current: kittyColors('#7daea3') }
  const { configs } = world(on, colors)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const first = await $.ui.mount(reply(FLOW))
  await clock.settle()

  colors.current = kittyColors('#1e66f5', '#4c4f69', '#eff1f5')
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  const second = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(variables(configs.at(-1)).lineColor).toBe('#1e66f5')
  expect(variables(configs.at(-1)).darkMode).toBe(false)
  await first.unmount()
  await second.unmount()
})

test('a hex theme never asks the terminal for its colors', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { kitty } = world(on, { current: kittyColors('#7daea3') })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(reply(FLOW))
  await clock.settle()

  expect(kitty.some(argv => argv.includes('get-colors'))).toBe(false)
  await ui.unmount()
})
