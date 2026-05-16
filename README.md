# Obsidian OpenCode Plugin

An Obsidian plugin that integrates the OpenCode CLI directly into your Obsidian vault.

## Known Issues

- **Session Previews / Loading:** While the buffer size for exporting sessions has been increased to 100MB, some exceptionally large or deeply complex OpenCode sessions may still fail to preview or load properly. If a session fails to load, it might exceed this buffer limit or contain data that the parser cannot process.
