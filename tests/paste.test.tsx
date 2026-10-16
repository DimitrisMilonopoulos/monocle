import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fitPreview, imageRefs, pastedImages } from '../hooks/paste'

const PNG_800x400 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQAQAAAAB+XjmZAAAAPklEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4NndAAAYtfwy0AAAAASUVORK5CYII='
const JPEG = '/9j/4AAQSkZJRgABAQ=='

const KITTY = { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '7', TMPDIR: '/tmp/', HOME: '/home/me' }

const pasted = (text: string, images: { media_type: string; data: string }[]) => ({
  role: 'user' as const,
  content: [{ type: 'text', text }, ...images.map(source => ({ type: 'image', source: { type: 'base64', ...source } }))],
})

type Run = { argv: readonly string[]; data?: string }

const base = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path

const world = (on: On, messages: unknown[]) => {
  const runs: Run[] = []
  const files = new Map<string, string>()
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.messages', () => ({ value: messages as never }))
  const written = new Map<string, string>()
  on('fs.write', (_, e) => {
    written.set(base(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, data: written.get(base(String(e.argv[4]))) })
    if (e.argv[0] === 'sh') files.set(base(String(e.argv[5])), PNG_800x400)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => (files.has(base(e.path)) ? { value: { base64: files.get(base(e.path))! } } : { deny: `no such file ${e.path}` }))
  return runs
}

const started = async ($: Engine, on: On) => {
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

const prompt = (text: string) => ({
  plugin: 'monocle',
  component: 'UserMessage' as const,
  props: { text, origin: { kind: 'composer' as const }, isExpanded: false },
  viewport: { columns: 120, rows: 40 },
  surface: 'terminal' as const,
})

test('a pasted image shows under the prompt that carried it', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  world(on, [pasted('[Image #1] what is this?', [{ media_type: 'image/png', data: PNG_800x400 }])])
  await started($, on)

  const ui = await $.ui.mount(prompt('[Image #1] what is this?'))
  await clock.settle()

  const image = await ui.find({ type: 'Image' })
  expect(image?.props.alt).toBe('[Image #1]')
  expect(image?.props.source).toEqual({ png: PNG_800x400 })
  expect(await ui.find({ type: 'Text', text: /what is this/ })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})

test('a JPEG paste is converted to PNG with ImageMagick', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = world(on, [pasted('[Image #2]', [{ media_type: 'image/jpeg', data: JPEG }])])
  await started($, on)

  const ui = await $.ui.mount(prompt('[Image #2]'))
  await clock.settle()

  const convert = runs.find(r => r.argv[0] === 'sh')
  expect(convert?.argv[2]).toContain('magick')
  expect(convert?.argv.at(-1)).toBe('other')
  expect(convert?.data).toBe(JPEG)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('clicking a pasted image opens it full screen in a kitty overlay', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = world(on, [pasted('[Image #1]', [{ media_type: 'image/png', data: PNG_800x400 }])])
  await started($, on)

  const ui = await $.ui.mount(prompt('[Image #1]'))
  await clock.settle()
  const client = await ui.find({ type: 'Client' })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left', in: String(client?.key) })
  await ui.pointer({ type: 'up', x: 1, y: 1, button: 'left', in: String(client?.key) })
  await clock.settle()

  const written = runs.find(r => r.argv[0] === 'sh')
  const launch = runs.find(r => r.argv[0] === 'kitty' && r.argv[1] === '@')
  expect(written?.data).toBe(PNG_800x400)
  expect(written?.argv.at(-1)).toBe('png')
  expect(launch?.argv).toEqual(expect.arrayContaining(['--type=overlay', '--title=image']))
  expect(launch?.argv.at(-1)).toBe(written?.argv[5])
  await ui.unmount()
})

test('under tmux no image is drawn', async ($, on) => {
  mock.env(on, { ...KITTY, TMUX: '/tmp/tmux-1/default,1,0' })
  const clock = mock.clock(on)
  world(on, [pasted('[Image #1]', [{ media_type: 'image/png', data: PNG_800x400 }])])
  await started($, on)

  const ui = await $.ui.mount(prompt('[Image #1]'))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('image refs pair with the image blocks of their message, in order', async () => {
  expect(imageRefs('see [Image #3] and [Image #4]')).toEqual([3, 4])
  const found = pastedImages([
    pasted('[Image #1]', [{ media_type: 'image/png', data: 'one' }]),
    { role: 'assistant', content: [{ type: 'text', text: '[Image #9]' }] },
    pasted('[Image #2] then [Image #3]', [{ media_type: 'image/png', data: 'two' }, { media_type: 'image/jpeg', data: 'three' }]),
  ])
  expect([...found].map(([id, s]) => [id, s.data])).toEqual([[1, 'one'], [2, 'two'], [3, 'three']])
})

test('a preview keeps its aspect within twelve rows and the columns', async () => {
  expect(fitPreview({ width: 1200, height: 800 }, 120)).toEqual({ rows: 12, columns: Math.round((1200 / 800 / 0.46) * 12) })
  expect(fitPreview({ width: 4000, height: 200 }, 50)!.columns).toBeLessThanOrEqual(50)
  expect(fitPreview({ width: 40, height: 20 }, 120)).toEqual({ rows: 1, columns: 4 })
})
