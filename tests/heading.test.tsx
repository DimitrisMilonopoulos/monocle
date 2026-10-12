import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { fitHeading, ghosttyFont, headingColor, labelText, wrapHeading } from '../hooks/heading'
import { PRESETS } from '../hooks/presets'

const PNG_800x400 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQAQAAAAB+XjmZAAAAPklEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4NndAAAYtfwy0AAAAASUVORK5CYII='

const KITTY = { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '7', TMPDIR: '/tmp/', HOME: '/home/me' }
const MOCHA = PRESETS['catppuccin-mocha']
const REPLY = '# Big title\n\nIntro.\n\n## A section\n\nBody.\n\n### Smaller\n\nMore.'

type Paint = { argv: readonly string[]; text: string }

const base = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path

const magick = (on: On, { installed = true } = {}) => {
  const paints: Paint[] = []
  const dirs = new Set<string>()
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', (_, e) => {
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'kitty') return ok('JetBrainsMono Nerd Font\n')
    if (e.argv[0] === 'fc-match') return ok(e.argv.at(-1) === 'JetBrainsMono Nerd Font:bold' ? '/fonts/JBMono-Bold.ttf' : '/fonts/Mono-Bold.ttf')
    if (e.argv[0] !== 'magick' || !installed) return { deny: `spawn ${e.argv[0]} ENOENT` }
    if (e.argv[1] !== '-version' && ![...dirs].some(dir => dir.endsWith(String(e.argv.at(-1)).replace(/\/[^/]*$/, '')))) return { value: { exitCode: 1, stdout: '', stderr: 'unable to open image: No such file or directory', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[1] !== '-version') paints.push({ argv: e.argv, text: String(e.argv.find(a => a.startsWith('label:'))).slice('label:'.length) })
    return ok('Version: ImageMagick 7')
  })
  on('fs.write', (_, e) => {
    dirs.add(e.path.replace(/\\/g, '/').replace(/\/[^/]*$/, ''))
    return { value: undefined }
  })
  on('fs.read', (_, e) => (paints.some(p => base(String(p.argv.at(-1))) === base(e.path)) ? { value: { base64: PNG_800x400 } } : { deny: `no such file ${e.path}` }))
  return paints
}

const reply = (text: string, columns = 120) => ({
  plugin: 'ocellus',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

test('# and ## headings draw as big images in the terminal font and their level color', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const paints = magick(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const images = await ui.findAll({ type: 'Image' })
  expect(images.map(i => [i.props.alt, i.props.rows])).toEqual([['Big title', 3], ['A section', 2]])
  expect(paints.map(p => p.text)).toEqual(['Big title', 'A section'])
  expect(paints[0]!.argv).toEqual(expect.arrayContaining(['-font', '/fonts/JBMono-Bold.ttf', '-fill', MOCHA.heading]))
  expect(paints[1]!.argv).toEqual(expect.arrayContaining(['-fill', MOCHA.accent]))
  expect(await ui.find({ type: 'Text', text: /^Smaller$/ })).toBeDefined()
  await ui.unmount()
})

test('a heading still being written, the last block of the reply, stays text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const paints = magick(on)

  const ui = await $.ui.mount(reply('Intro.\n\n# Big ti'))
  await clock.settle()

  expect(paints).toHaveLength(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('without ImageMagick, headings stay text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  magick(on, { installed: false })

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Big title$/ })).toBeDefined()
  await ui.unmount()
})

test('headingImages off never runs ImageMagick', { options: { headingImages: false } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const paints = magick(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(paints).toHaveLength(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('each heading level has its own color', async $ => {
  const ui = await $.ui.mount({ ...reply('### Three\n\n#### Four\n\n##### Five\n\nend'), surface: 'desktop' as const })

  expect((await ui.find({ type: 'Text', text: /^Three$/ }))?.props.color).toBe(MOCHA.link)
  expect((await ui.find({ type: 'Text', text: /^Four$/ }))?.props.color).toBe(MOCHA.number)
  expect((await ui.find({ type: 'Text', text: /^Five$/ }))?.props.color).toBe(MOCHA.emphasis)
  await ui.unmount()
})

test('heading colors run heading, accent, link, number, emphasis', async () => {
  expect([1, 2, 3, 4, 5, 6].map(level => headingColor(MOCHA, level))).toEqual([MOCHA.heading, MOCHA.accent, MOCHA.link, MOCHA.number, MOCHA.emphasis, MOCHA.emphasis])
})

test('long headings wrap on words and split words longer than a line', async () => {
  expect(wrapHeading('Why the cache change made latency fall', 16)).toEqual(['Why the cache', 'change made', 'latency fall'])
  expect(wrapHeading('Supercalifragilistic', 8)).toEqual(['Supercal', 'ifragili', 'stic'])
})

test('a heading image is as many rows as its level and lines, and must fit the columns', async () => {
  const two = { level: 1, color: '#fff', lines: ['a', 'b'] }
  expect(fitHeading({ width: 800, height: 200 }, two, 120)).toEqual({ rows: 6, columns: Math.round((6 * 4) / 0.46) })
  expect(fitHeading({ width: 8000, height: 100 }, { ...two, lines: ['a'] }, 120)).toBeNull()
})

test('heading text reaches ImageMagick with its escapes neutralized', async () => {
  expect(labelText(['@/etc/passwd 100% done'])).toBe('\\@/etc/passwd 100%% done')
  expect(labelText(['back\\slash', 'line two'])).toBe('back\\\\slash\\nline two')
})

test("Ghostty's font comes from the first font-family it reports", async () => {
  expect(ghosttyFont('font-size = 13\nfont-family = \nfont-family = "JetBrains Mono"\nfont-family = Symbols')).toBe('JetBrains Mono')
  expect(ghosttyFont('font-size = 13\nfont-family = \n')).toBeNull()
})
