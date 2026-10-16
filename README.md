<h1 align="center"><img src="docs/brand/banner.png" alt="monocle" width="640"></h1>

<p align="center"><em>Eye candy for Claude Code: real diagrams, images and color in your terminal.</em></p>

<p align="center">
  <a href="https://github.com/DimitrisMilonopoulos/monocle/releases"><img src="https://img.shields.io/github/v/release/DimitrisMilonopoulos/monocle?style=flat-square&color=cba6f7" alt="Release"></a>
  <a href="https://github.com/DimitrisMilonopoulos/monocle/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/DimitrisMilonopoulos/monocle/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/DimitrisMilonopoulos/monocle?style=flat-square&color=cba6f7" alt="License"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-2.1.287%2B-cba6f7?style=flat-square" alt="Claude Code 2.1.287 or later">
</p>

<p align="center">
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#images-in-kitty-and-ghostty">Images</a> ·
  <a href="#configure">Configure</a> ·
  <a href="docs/REFERENCE.md">Reference</a> ·
  <a href="docs/CHANGELOG.md">Changelog</a>
</p>

![A reply drawn by monocle in kitty: a big heading, a colored table and a mermaid flowchart drawn as an image](docs/hero.png)

## What it does

- Claude Code prints mermaid as source, tables as pipes and tool calls as walls of text. monocle draws them.
- In kitty and Ghostty you get real pixels: every mermaid diagram type as an image, big `#` and `##` headings in your terminal's font, the images you paste under your prompt, and optional LaTeX math.
- Everywhere else, colored text art: flowcharts, sequence diagrams and charts, colored tables and code, and quiet one-line tool rows.
- 15 palettes, `mono`, and `ansi`, which follows your terminal's theme as you switch it.
- No network calls, nothing installed for you. Turn it off in `/plugin` and Claude Code's own renderer comes back.

## Install

Needs Claude Code 2.1.287 or later. In Claude Code, run:

```
/plugin marketplace add DimitrisMilonopoulos/monocle
```

```
/plugin install monocle@monocle
```

Then `/monocle demo` shows the main features. To update, run this and then `/reload` in every open session:

```bash
claude plugin marketplace update monocle && claude plugin update monocle@monocle
```

To uninstall:

```bash
claude plugin uninstall monocle@monocle
```

### What each feature needs

monocle installs nothing. It uses a program only if it finds it on your `PATH`, and a feature whose program is missing falls back to text. Run `/monocle doctor` to see what's ready on your machine; [docs/SETUP.md](docs/SETUP.md) has the install commands for macOS (Homebrew) and Linux.

| Feature | Terminal | Needs |
|---|---|---|
| Colors, tables, code, text-art diagrams, tool rows | any | nothing |
| Mermaid diagrams as images | kitty or Ghostty | `mmdc` (mermaid-cli) and Chrome or Chromium |
| Big `#` and `##` headings | kitty or Ghostty | ImageMagick and `fc-match` (fontconfig) |
| Pasted images under the prompt | kitty or Ghostty | nothing for PNG; ImageMagick for JPEG, GIF and WebP |
| Click a diagram or image to zoom | kitty | kitty remote control on |
| `ansi` colors in diagrams and headings | kitty or Ghostty | kitty: remote control on |
| LaTeX math as images | kitty or Ghostty | RaTeX's `ratex-render`, and `latex` set to `true` |
| `⧉ html` table copy | local macOS, or Linux desktop | Linux: CopyQ running |

Images never show inside tmux, which doesn't pass them through.

## Images in kitty and Ghostty

![Mermaid diagrams drawn as images in kitty: a sequence diagram, a pie chart and a bar and line chart](docs/diagrams.png)

- **Diagrams:** every mermaid type renders with `mmdc` in the theme's colors, including pie, gantt, mindmap, timeline and git graphs. A diagram shows as text art first and turns into an image about two seconds later.
- **Zoom:** in kitty, click a diagram or press `⤢ zoom` to open it full screen, rendered at twice the resolution. Enter closes it.
- **Big headings:** `#` and `##` draw three and two rows tall in your terminal's bold font.
- **Pasted images** show under the prompt that carried them instead of only `[Image #1]`.

![A pasted image shown under the prompt that carried it](docs/paste.png)

## Everything else it draws

| | |
|---|---|
| Tables | colored header and rules, alignment, colored numbers, columns that shrink to fit |
| Code | a language header and copy button, highlighting for two dozen languages, colored shell commands |
| Text-art diagrams | flowcharts, sequence, state, class and ER diagrams, bar and line charts, in any terminal |
| Text | bold, italic, links, numbers, versions, durations and paths in their own colors |
| Headings, lists, quotes | four heading styles, nested and task lists, GitHub alerts as colored boxes |
| Tool rows | `Ran npm test`, `Read src/app.ts`, groups summed up in one line; `toolOutput: quiet` hides what Claude only read |
| Your prompts | a bubble, bar or chevron so you find your turns, and an optional clock |
| Copy buttons | `⧉ md`, `⧉ art` and `⧉ html` on tables, `⧉ copy` on code, lists, quotes, diagrams and whole replies |
| Right to left | Hebrew and Arabic read right to left, with bullets, quotes and tables mirrored |
| Slash commands | `/cost`, `/context` and plugin output drawn like replies |
| Diagram hints | a short note only the model reads, so Claude reaches for diagrams when they help |

Each one, with its options, is in [docs/REFERENCE.md](docs/REFERENCE.md).

## Configure

`/monocle theme <name>` switches the theme on the spot:

- Dark: `catppuccin-mocha` (default), `dracula`, `nord`, `tokyo-night`, `gruvbox-dark`, `rose-pine`, `everforest`, `github-dark`, `one-dark`, `solarized-dark`
- Light: `catppuccin-latte`, `gruvbox-light`, `rose-pine-dawn`, `github-light`, `solarized-light`
- `ansi` follows your terminal's own colors as you switch its theme ([how](docs/REFERENCE.md#the-ansi-theme))
- `mono` uses only bold and dim, and `random` picks a dark theme each time the mod loads

Everything else is a row in `/config`, or a key in `~/.claude/settings.json`, followed by `/reload`:

```json
{
  "pluginConfigs": {
    "monocle@monocle": {
      "options": { "theme": "ansi", "tableStyle": "grid", "toolOutput": "quiet", "clock": "24h" }
    }
  }
}
```

| Option | Values | Default |
| --- | --- | --- |
| `tableStyle` | `box`, `rules`, `grid`, `minimal` | `box` |
| `headingStyle` | `banner`, `bold`, `underline`, `uppercase` | `banner` |
| `promptStyle` | `bubble`, `bar`, `chevron`, `off` | `bubble` |
| `toolStyle` | `chat`, `tree-dim`, `tree-bold`, `classic` | `chat` |
| `toolOutput` | `full`, `quiet` | `full` |
| `clock` | `off`, `24h`, `12h` | `off` |
| `mermaidImages`, `headingImages` | `true`, `false` | `true` |
| `latex` | `true`, `false` | `false` |

Every option, and the 20 color slots you can override one by one, are in [docs/REFERENCE.md](docs/REFERENCE.md#options).

## Troubleshooting

- **Something that needs a program doesn't show:** run `/monocle doctor`, install what it lists, then `/reload`.
- **A setting or update didn't take:** run `/reload`. A session keeps what it loaded.
- **A diagram shows as code:** it's over 80 lines, wider than the window, doesn't parse, or `mermaid` is off.
- **Clicking a copy button selects the word "copy":** your terminal copies on select. Use `/monocle copy`.

<details>
<summary>For LLMs and agents</summary>

To change the code, read [AGENTS.md](AGENTS.md) instead.

- **What it is:** a Claude Code mod (function hooks in TypeScript) that redraws assistant replies, slash-command output, tool rows, the turn footer and user prompts. It changes how things look. The one thing it sends the model is the optional diagram hint below.
- **Install:** `/plugin marketplace add DimitrisMilonopoulos/monocle`, then `/plugin install monocle@monocle`. Needs Claude Code 2.1.287+. Changes apply after `/reload`.
- **Configure:** `/monocle theme <name>` is the only setter at runtime. Every other option is a key under `pluginConfigs["monocle@monocle"].options` in `~/.claude/settings.json` (or a row in `/config`), then `/reload`. Options and defaults are in [docs/REFERENCE.md](docs/REFERENCE.md#options); the machine-readable source is `userConfig` in [.claude-plugin/plugin.json](.claude-plugin/plugin.json). Color values that don't parse are ignored.
- **Side effects:** no network. Programs it runs: the `⧉ html` clipboard helper (`/usr/bin/osascript` on macOS, `copyq` on Linux, 5 second timeout, only on a click), `ratex-render` while `latex` is on, `mmdc` (which starts a headless Chrome with its network turned off) for mermaid blocks while `mermaidImages` is on, in kitty or Ghostty, `kitty @ launch` when you zoom a diagram, and `magick`, `fc-match` and `kitty +runpy` (to find your font) for big headings while `headingImages` is on. With `diagramHints` on, it adds about 190 tokens of model-only context to each typed prompt.
- **Turning it off:** `"enabled": false`, or disable the plugin in `/plugin`.
- **For other mods:** `$.monocle.markdown({ surface, text, columns })`, typed in [types/index.d.ts](types/index.d.ts). See [docs/MODS.md](docs/MODS.md).

</details>

## Develop

```bash
git clone https://github.com/DimitrisMilonopoulos/monocle
claude --plugin-dir ./monocle
```

Edits hot-reload in that session. [AGENTS.md](AGENTS.md) has the rules and the checks to run before a commit, and [docs/MODS.md](docs/MODS.md) shows how other mods can draw markdown with monocle.

## Credits

monocle is made by [Dimitrios Milonopoulos](https://github.com/DimitrisMilonopoulos). It started as a fork of [prismantis](https://github.com/NahumLitvin/prismantis) by [Nahum Litvin](https://github.com/NahumLitvin), whose work covers everything up to 0.17.1 in the [changelog](docs/CHANGELOG.md).

## License

[MIT](LICENSE). Bundled third-party code is listed in [THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md).
