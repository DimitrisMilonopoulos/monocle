export type Platform = 'mac' | 'linux' | 'other'

export type Facts = {
  platform: Platform
  terminal: string | null
  tmux: boolean
  forced: boolean
  mmdc: string | null
  browser: string | null
  magick: string | null
  fcMatch: string | null
  font: string | null
  kittyRemote: boolean | null
  ratex: string | null
  latex: boolean
}

type Row = { feature: string; ok: boolean; status: string; fix?: string }

const install = (platform: Platform, mac: string, linux: string) => (platform === 'mac' ? mac : linux)

const VIEWERS: Record<string, string> = { kitty: 'kitty', ghostty: 'Ghostty', herdr: 'herdr' }

const rows = (f: Facts): Row[] => {
  const viewer = f.tmux ? undefined : VIEWERS[f.terminal ?? '']
  const imageRow: Row = f.terminal === 'herdr' && !f.forced && !f.tmux
    ? { feature: 'Images in the terminal', ok: false, status: 'herdr, which Claude Code does not draw images in by itself', fix: 'start Claude Code with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` inside herdr' }
    : viewer
    ? { feature: 'Images in the terminal', ok: true, status: viewer }
    : {
        feature: 'Images in the terminal',
        ok: false,
        status: f.tmux ? 'inside tmux' : `${f.terminal ?? 'this terminal'} has no kitty graphics`,
        fix: f.tmux ? 'run Claude Code outside tmux' : 'use kitty, Ghostty or herdr',
      }
  const browserFix = install(f.platform, '`brew install --cask google-chrome`', '`npm install -g @mermaid-js/mermaid-cli` fetches one, or install Chromium')
  return [
    imageRow,
    f.mmdc
      ? f.browser
        ? { feature: 'Mermaid as images', ok: true, status: `mmdc, ${f.browser}` }
        : { feature: 'Mermaid as images', ok: false, status: 'mmdc finds no browser', fix: browserFix }
      : { feature: 'Mermaid as images', ok: false, status: 'mmdc not found', fix: install(f.platform, '`brew install mermaid-cli`', '`npm install -g @mermaid-js/mermaid-cli`') },
    !f.magick
      ? { feature: 'Big headings', ok: false, status: 'ImageMagick not found', fix: install(f.platform, '`brew install imagemagick`', '`sudo apt install imagemagick` or `sudo pacman -S imagemagick`') }
      : !f.fcMatch
        ? { feature: 'Big headings', ok: false, status: 'fc-match not found', fix: install(f.platform, '`brew install fontconfig`', '`sudo apt install fontconfig` or `sudo pacman -S fontconfig`') }
        : { feature: 'Big headings', ok: !!f.font, status: f.font ? `${f.magick}, ${f.font}` : 'no bold monospace font found', ...(f.font ? {} : { fix: 'install a monospace font with a bold face' }) },
    {
      feature: 'Pasted images',
      ok: true,
      status: f.magick ? 'PNG, JPEG, GIF and WebP' : 'PNG only',
      ...(f.magick ? {} : { fix: 'ImageMagick, as for big headings, shows other formats' }),
    },
    f.kittyRemote === null
      ? { feature: 'Click to zoom', ok: false, status: f.terminal === 'herdr' ? 'not inside herdr' : 'kitty only' }
      : f.kittyRemote
        ? { feature: 'Click to zoom', ok: true, status: 'kitty remote control' }
        : { feature: 'Click to zoom', ok: false, status: 'kitty remote control is off', fix: 'add `allow_remote_control socket-only` and `listen_on unix:/tmp/kitty` to kitty.conf, then restart kitty' },
    !f.latex
      ? { feature: 'LaTeX math', ok: false, status: 'off', fix: f.ratex ? 'set `latex` to `true` in `/config`' : 'install RaTeX as `ratex-render`, then set `latex` to `true`' }
      : f.ratex
        ? { feature: 'LaTeX math', ok: true, status: 'ratex-render' }
        : { feature: 'LaTeX math', ok: false, status: 'ratex-render not found', fix: 'install RaTeX as `ratex-render` on your PATH' },
  ]
}

const cell = (text: string) => text.replace(/\|/g, '\\|')

export const doctorText = (facts: Facts): string => {
  const table = rows(facts).map(r => `| ${r.feature} | ${r.ok ? '✓' : '✗'} ${cell(r.status)} | ${cell(r.fix ?? '')} |`)
  return [
    '## monocle doctor',
    '',
    '| Feature | Status | To fix |',
    '|---|---|---|',
    ...table,
    '',
    'Anything not ready falls back to text, so nothing breaks. After installing, run `/reload`. Full guide: docs/SETUP.md',
  ].join('\n')
}
