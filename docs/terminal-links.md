# Links in terminal output

Web addresses and existing Markdown note paths are clickable wherever xterm renders text, including agent responses and side terminals. HTTP and HTTPS addresses use Electron's system-browser opener. Other external schemes are ignored, including OSC 8 terminal hyperlinks.

Note paths resolve relative to the active vault, regardless of the terminal's working directory. Relative paths, absolute paths inside the vault, `/` and `\` separators, spaces and Unicode are supported. Backticks, quotes, parentheses and Markdown link destinations can delimit a path. For unquoted space-containing paths, the provider chooses the first candidate that matches an existing indexed note, excluding preceding prose. It does not search by note basename or create missing files.

Suffixes `:42` and `:42:8` mean one-based line and column. The editor opens in source mode for these locations and clamps a position beyond the end of a note. Obsidian's normal Cmd/Ctrl modifier behavior selects a new tab or split. Ordinary clicks open through the normal navigable editor leaf.

When OpenCode enables terminal mouse reporting, ordinary clicks remain owned by its TUI. Hold Cmd/Ctrl while clicking a link to activate it. Dragging or an existing terminal selection never activates a link. Modifier activation on a hovered link consumes its mouse press/release before they reach OpenCode; non-link input keeps its normal behavior.

Paths must resolve lexically inside the active vault and refer to an indexed Markdown file. Activation additionally checks canonical filesystem paths, rejecting symlinks that escape the vault. There is no outside-file fallback. Under WSL, Windows drive paths map to `/mnt/<drive>` only when the active vault uses that mount. `\\wsl.localhost\<distro>` and `\\wsl$\<distro>` aliases require the active `WSL_DISTRO_NAME` to match. Custom WSL automount locations are not inferred.

Wrapped xterm lines use cell coordinates, including wide characters, surrogate pairs, combining characters and wide-character wrap padding. Hard line breaks are not joined. Detection is bounded to 128 wrapped rows, 16,384 UTF-16 units per logical line and 4,096 units per delimiter-bounded path phrase. Filesystem canonicalization runs only on activation, never on hover; hover checks use indexed vault lookups.

xterm 5.5 does not expose OSC 8 cell URLs in its public API. The isolated `xtermOsc8.ts` adapter reads its cell URL id and link registry to verify the current target instead of trusting cached hover state. It fails closed when URL metadata exists but the registry is unavailable; this seam must be checked when upgrading xterm.

`src/modules/terminalLinks.test.ts` covers parsing, ranges, canonical containment, activation, mouse ownership and lifecycle cleanup. `test/specs/terminal-links.e2e.ts` exercises the actual xterm provider, pointer hit testing and Obsidian editor navigation in the fresh test vault, with only the external browser side effect stubbed. Run app tests serially with other Obsidian tests.
