# CDP Integration Guide

Detailed guide for working with the Chrome DevTools Protocol (CDP) in obsidian-mcp-server.

## Overview

CDP provides native access to Obsidian's internals through Chrome's debugging protocol. This enables:

- Direct access to the `app` global object
- Plugin API access (Dataview, Templater, etc.)
- UI automation and control
- O(1) file operations
- Real-time metadata cache access

## Connection Flow

```
1. Discover targets via http://localhost:9222/json
2. Connect WebSocket to target
3. Attach to target with Target.attachToTarget
4. Enable Runtime domain
5. Execute JavaScript via Runtime.evaluate
```

## ObsidianCdpService API

### Connection Management

```typescript
// Check connection status
if (cdpService.isConnected()) {
  // Safe to use CDP
}

// Get error details for troubleshooting
const { error, isBusy } = cdpService.getErrorDetails();
if (isBusy) {
  // Port 9222 is in use by another debugger
}
```

### JavaScript Evaluation

```typescript
// Simple evaluation
const result = await cdpService.evaluate(
  `
  app.vault.getMarkdownFiles().map(f => f.path)
`,
  context,
);

// With error handling
try {
  const result = await cdpService.evaluate(
    `
    const file = app.vault.getAbstractFileByPath("test.md");
    if (!file) throw new Error("File not found");
    return file.stat;
  `,
    context,
  );
} catch (error) {
  // Handles JavaScript execution errors
}
```

### Raw CDP Commands

```typescript
// Send any CDP command
const result = await cdpService.sendRawCommand("Runtime.evaluate", {
  expression: "1 + 1",
  returnByValue: true,
  awaitPromise: true,
});
```

## CdpEvaluator Helper

The `CdpEvaluator` class provides higher-level operations:

```typescript
import { CdpEvaluator } from "../../../services/obsidianCdp/index.js";

const evaluator = new CdpEvaluator(cdpService);

// Execute Dataview DQL query
const dvResult = await evaluator.executeDataviewQuery(
  'TABLE file.mtime, tags FROM #project WHERE status = "active"',
  context,
);

// Safe evaluation with timeout and error handling
const result = await evaluator.evaluateWithSafety(
  `
  app.plugins.plugins.dataview?.api
`,
  true,
  context,
); // true = retry on failure
```

## Common CDP Patterns

### Accessing Vault

```typescript
// List all markdown files
const files = await cdpService.evaluate(
  `
  app.vault.getMarkdownFiles().map(f => ({
    path: f.path,
    name: f.name,
    stat: f.stat
  }))
`,
  context,
);

// Get file content
const content = await cdpService.evaluate(
  `
  await app.vault.cachedRead(
    app.vault.getAbstractFileByPath("${filePath}")
  )
`,
  context,
);

// Write file content
await cdpService.evaluate(
  `
  await app.vault.modify(
    app.vault.getAbstractFileByPath("${filePath}"),
    "${newContent.replace(/"/g, '\\"')}"
  )
`,
  context,
);
```

### Metadata Cache

```typescript
// Get all tags
const tags = await cdpService.evaluate(
  `
  Object.keys(app.metadataCache.getTags())
`,
  context,
);

// Get file metadata
const metadata = await cdpService.evaluate(
  `
  app.metadataCache.getFileCache(
    app.vault.getAbstractFileByPath("${filePath}")
  )
`,
  context,
);

// Get backlinks
const backlinks = await cdpService.evaluate(
  `
  app.metadataCache.getBacklinksForFile(
    app.vault.getAbstractFileByPath("${filePath}")
  ).data
`,
  context,
);
```

### Dataview Queries

```typescript
// DQL query
const result = await evaluator.executeDataviewQuery(
  `
  TABLE file.mtime
  FROM #project
  SORT file.mtime DESC
  LIMIT 10
`,
  context,
);

// DataviewJS query
const jsResult = await evaluator.evaluateWithSafety(
  `
  const dv = app.plugins.plugins.dataview.api;
  const pages = dv.pages("#project");
  return pages.map(p => ({
    path: p.file.path,
    tags: p.file.tags
  }));
`,
  false,
  context,
);
```

### UI Control

```typescript
// Click element
await cdpService.evaluate(
  `
  document.querySelector('.nav-file-title').click()
`,
  context,
);

// Type in input
await cdpService.evaluate(
  `
  const input = document.querySelector('.search-input');
  input.value = "search term";
  input.dispatchEvent(new Event('input'));
`,
  context,
);

// Get UI state
const uiState = await cdpService.evaluate(
  `
  (() => {
    const fileExplorer = document.querySelector('.nav-files-container');
    const activeFile = document.querySelector('.mod-active .nav-file-title');
    return {
      fileExplorerVisible: !!fileExplorer,
      activeFile: activeFile?.getAttribute('data-path')
    };
  })()
`,
  context,
);
```

### Plugin Access

```typescript
// Check if plugin is installed
const hasDataview = await cdpService.evaluate(
  `
  !!app.plugins.plugins.dataview
`,
  context,
);

// Access plugin API
const dataviewVersion = await cdpService.evaluate(
  `
  app.plugins.plugins.dataview.manifest.version
`,
  context,
);

// Use Templater
await cdpService.evaluate(
  `
  const tp = app.plugins.plugins['templater-obsidian'];
  await tp.templater.replace_templates_in_file(
    app.vault.getAbstractFileByPath("${filePath}")
  );
`,
  context,
);
```

## Error Handling

### Common Errors

```typescript
// Connection not available
if (!cdpService?.isConnected()) {
  throw new McpError(
    BaseErrorCode.SERVICE_UNAVAILABLE,
    "CDP not connected. Start Obsidian with --remote-debugging-port=9222",
  );
}

// JavaScript execution error
try {
  await cdpService.evaluate(`throw new Error("test")`, context);
} catch (error) {
  // Error: JavaScript execution failed: test
}

// Timeout
// CDP commands timeout after 30 seconds by default
```

### Retry Logic

```typescript
// Use CdpEvaluator for automatic retry
const result = await evaluator.evaluateWithSafety(
  expression,
  true, // retry on failure
  context,
);
```

## Performance Considerations

1. **Minimize round trips**: Batch operations when possible
2. **Use returnByValue**: Always set `returnByValue: true` to get serializable results
3. **Limit result size**: CDP can fail with large payloads (>100MB)
4. **Avoid complex objects**: Return plain objects/arrays, not class instances

```typescript
// Good: Returns simple object
const result = await cdpService.evaluate(
  `
  (() => {
    const files = app.vault.getMarkdownFiles();
    return {
      count: files.length,
      first: files[0]?.path
    };
  })()
`,
  context,
);

// Bad: Returns complex TFile objects
const bad = await cdpService.evaluate(
  `
  app.vault.getMarkdownFiles()  // Too complex to serialize
`,
  context,
);
```

## Testing CDP Tools

```typescript
import { describe, it, expect, vi } from "vitest";

describe("CDP Tool", () => {
  it("should use CDP when available", async () => {
    const mockCdpService = {
      isConnected: vi.fn().mockReturnValue(true),
      evaluate: vi.fn().mockResolvedValue({ success: true }),
    };

    const result = await processTool(
      params,
      context,
      mockService,
      undefined,
      mockCdpService,
    );

    expect(result.source).toBe("cdp");
    expect(mockCdpService.evaluate).toHaveBeenCalled();
  });

  it("should fall back to REST when CDP unavailable", async () => {
    const mockCdpService = {
      isConnected: vi.fn().mockReturnValue(false),
    };

    const result = await processTool(
      params,
      context,
      mockService,
      undefined,
      mockCdpService,
    );

    expect(result.source).toBe("rest");
  });
});
```

## Troubleshooting

### Port Already in Use

```
Error: CDP port (9222) is busy
```

**Solution**: Close other debuggers (Chrome DevTools, MCP Inspector, etc.)

### Connection Timeout

```
Error: WebSocket connection timeout
```

**Solutions**:

- Ensure Obsidian is running with `--remote-debugging-port=9222`
- Check firewall settings
- Verify port isn't blocked

### JavaScript Execution Errors

```
Error: JavaScript execution failed: ...
```

**Debugging**:

1. Test code in Obsidian DevTools first
2. Check that all referenced objects exist
3. Use IIFE wrapper: `(() => { ... })()`
4. Escape strings properly

### Serialization Errors

```
Error: Object could not be cloned
```

**Solution**: Return plain objects only, not class instances or circular references
