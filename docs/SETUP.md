# Setting up monocle on macOS and Linux

monocle works with nothing extra installed: replies get colors, tables, text-art diagrams and tool rows anywhere Claude Code runs. The features that draw real pixels need a terminal that shows images and a few programs. Each one falls back to text when something is missing, so you can add them one at a time.

Run this in Claude Code at any point to see what's ready and what to install:

```
/monocle doctor
```

After installing anything, run `/reload` (or start a new session) so monocle checks again.

## What each feature needs

| Feature | Terminal | Programs |
|---|---|---|
| Mermaid diagrams as images | kitty or Ghostty | `mmdc` (mermaid-cli) and a Chrome or Chromium it can start |
| Big `#` and `##` headings | kitty or Ghostty | ImageMagick (`magick`, or `convert` from ImageMagick 6) and `fc-match` (fontconfig) |
| Pasted images under your prompt | kitty or Ghostty | none for PNG; ImageMagick for JPEG, GIF and WebP |
| Click a diagram or image to zoom | kitty | kitty remote control turned on |
| LaTeX math as images | kitty or Ghostty | RaTeX's `ratex-render`, and `latex` set to `true` |

"kitty or Ghostty" includes other terminals built on libghostty that report `TERM=xterm-ghostty`. Images never show inside tmux, which doesn't pass them through.

## macOS

Install [Homebrew](https://brew.sh) if you don't have it, then:

```bash
brew install node imagemagick fontconfig
npm install -g @mermaid-js/mermaid-cli
```

- `npm install -g @mermaid-js/mermaid-cli` downloads the headless Chrome that `mmdc` renders with into `~/.cache/puppeteer`. If you skip that download, monocle points `mmdc` at `/Applications/Google Chrome.app` or `/Applications/Chromium.app` when either is installed.
- Homebrew's ImageMagick already pulls in fontconfig; listing it makes sure `fc-match` is on your `PATH`.
- Ghostty on macOS needs nothing more. monocle reads your `font-family` through the `ghostty` command, or `/Applications/Ghostty.app` when it isn't on your `PATH`.

## Linux

Debian and Ubuntu:

```bash
sudo apt install imagemagick fontconfig nodejs npm
sudo npm install -g @mermaid-js/mermaid-cli
```

Arch:

```bash
sudo pacman -S imagemagick fontconfig nodejs npm
sudo npm install -g @mermaid-js/mermaid-cli
```

- On Arch you can instead install the `mermaid-cli` and `chromium` packages; monocle finds `/usr/bin/chromium` and hands it to `mmdc`.
- Debian and Ubuntu ship ImageMagick 6, which has `convert` instead of `magick`. monocle uses whichever it finds.
- If npm is set up to install global packages in your home directory, drop the `sudo`.

## kitty: turn on remote control for zoom

Clicking a diagram or a pasted image opens it full screen in a kitty overlay, which monocle asks kitty for over its remote-control socket. Add this to `kitty.conf` and restart kitty (a config reload isn't enough for `listen_on`):

```conf
allow_remote_control socket-only
listen_on unix:/tmp/kitty
```

On Linux, `listen_on unix:@kitty` uses an abstract socket instead of a file. `socket-only` lets programs talk to kitty through that socket only, not through the terminal itself.

Big headings use the `font_family` from your `kitty.conf`, so they match the rest of the text.

## Ghostty

Nothing to configure. Diagrams, headings and pasted images work; click to zoom is kitty only, so Ghostty shows no zoom button.

## herdr

[herdr](https://herdr.dev) passes images through to kitty or Ghostty, but it reports itself as libghostty, which Claude Code doesn't draw images in by itself. Tell it to, for Claude Code started inside herdr only, in your `~/.bashrc` or `~/.zshrc`:

```bash
[ "$TERM_PROGRAM" = herdr ] && export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
```

Then diagrams, big headings and pasted images work as in the terminal herdr runs in, and headings use that terminal's font. Without it, monocle keeps text-art diagrams and plain headings. Click to zoom is off inside herdr, because a kitty overlay would cover every herdr pane, not just the one you clicked.

## LaTeX math (optional)

LaTeX is off by default. Install RaTeX's renderer as `ratex-render` on your `PATH` (see [LaTeX math](../README.md#latex-math) in the README for the download), then set `latex` to `true` in `/config`.

## Over SSH

Not tested yet. The programs have to be installed on the machine where Claude Code runs, and zoom is turned off over SSH because the kitty overlay has to open on the same machine.

## When something doesn't show

1. Run `/monocle doctor` and install what it lists.
2. Run `/reload`.
3. Still text? Start Claude Code with `claude --debug` and look for lines starting with `monocle` in the debug log under `~/.claude/debug/`.
