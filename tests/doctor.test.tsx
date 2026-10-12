import { expect, test } from 'claude-code/testing'

import type { Facts } from '../hooks/doctor'
import { doctorText } from '../hooks/doctor'

const READY: Facts = { platform: 'linux', terminal: 'kitty', tmux: false, forced: false, mmdc: '/usr/bin/mmdc', browser: '/usr/bin/chromium', magick: 'magick', fcMatch: '/usr/bin/fc-match', font: '/fonts/JB-Bold.ttf', kittyRemote: true, ratex: null, latex: false }

test('a ready machine shows every image feature ready', async () => {
  const text = doctorText(READY)
  for (const feature of ['Images in the terminal', 'Mermaid as images', 'Big headings', 'Pasted images', 'Click to zoom']) expect(text).toMatch(new RegExp(`\\| ${feature} \\| ✓`))
})

test('missing tools get the install command for the platform', async () => {
  const mac = doctorText({ ...READY, platform: 'mac', mmdc: null, magick: null })
  expect(mac).toContain('`brew install node`, then `npm install -g @mermaid-js/mermaid-cli`')
  expect(mac).toContain('`brew install imagemagick`')
  const linux = doctorText({ ...READY, mmdc: null, fcMatch: null })
  expect(linux).toContain('`npm install -g @mermaid-js/mermaid-cli`')
  expect(linux).toContain('fontconfig')
})

test('kitty without remote control is told how to turn it on, and tmux blocks images', async () => {
  expect(doctorText({ ...READY, kittyRemote: false })).toContain('allow_remote_control socket-only')
  expect(doctorText({ ...READY, tmux: true })).toMatch(/\| Images in the terminal \| ✗ inside tmux \| run Claude Code outside tmux \|/)
})

test('herdr shows images once Claude Code is told to, and has no zoom', async () => {
  expect(doctorText({ ...READY, terminal: 'herdr', kittyRemote: null })).toContain('`CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`')
  const text = doctorText({ ...READY, terminal: 'herdr', forced: true, kittyRemote: null })
  expect(text).toMatch(/\| Images in the terminal \| ✓ herdr \|/)
  expect(text).toMatch(/\| Click to zoom \| ✗ not inside herdr \|/)
})
