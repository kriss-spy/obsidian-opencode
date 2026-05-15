---
name: obsidian-mcp
description: Guide for developing and extending the obsidian-mcp-server project - an MCP server providing AI agents with access to Obsidian vaults via CDP/REST hybrid architecture.
---

# Obsidian MCP Server Development Guide

## Purpose

This skill guides agents through developing and extending the obsidian-mcp-server project. It covers the hybrid CDP/REST architecture, tool creation patterns, safety mechanisms, and testing approaches.

## When to Use This Skill

Use this skill when:

- Adding new tools to the obsidian-mcp-server
- Understanding the hybrid CDP/REST bridge architecture
- Debugging CDP connection or vault interaction issues
- Working with the vault cache or metadata systems
- Implementing safety features (backups, conflict detection)
- Setting up development environment and test vaults

### Trigger Phrases

- "obsidian mcp development"
- "add obsidian mcp tool"
- "create obsidian tool"
- "obsidian mcp architecture"
- "extend obsidian mcp"
- "obsidian mcp testing"
- "obsidian cdp tool"

## Architecture Overview

### Hybrid Bridge: CDP + REST

The obsidian-mcp-server uses a **dual-mode architecture**:

| Mode                | Use Case                                            | Performance               |
| ------------------- | --------------------------------------------------- | ------------------------- |
| **CDP (Native)**    | Dataview, UI control, metadata cache, native search | Instant (O(1) operations) |
| **REST (Fallback)** | File operations, cross-platform compatibility       | Standard HTTP latency     |

**Key Principle**: Tools should prefer CDP when available for performance, but gracefully fall back to REST. Every hybrid tool response includes a `source` field (`"cdp"`, `"rest"`, or `"cache"`).

### Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Server                               │
├─────────────────────────────────────────────────────────────────┤
│  Tools                                                          │
│  ├── obsidianDataviewTool        (CDP-only)                     │
│  ├── obsidianSearchReplaceTool   (REST + Cache)                 │
│  ├── obsidianMoveFolderTool      (CDP-preferred)                │
│  ├── obsidianMetadataCacheTool   (CDP-only)                     │
│  └── ...                                                        │
├─────────────────────────────────────────────────────────────────┤
│  Services                                                       │
│  ├── ObsidianRestApiService    ←→ Obsidian Local REST API       │
│  ├── ObsidianCdpService        ←→ Chrome DevTools Protocol      │
│  ├── VaultCacheService         ←→ Local LevelDB cache           │
│  └── TemplateService           ←→ Folder template engine        │
└─────────────────────────────────────────────────────────────────┘
```

## Tool Development Patterns

### Tool Structure

Each tool follows a 3-file pattern:

```
src/mcp-server/tools/obsidian[ToolName]Tool/
├── index.ts           # Re-exports registration
├── registration.ts    # MCP registration + input validation
└── logic.ts           # Business logic + Zod schemas
```

### 1. Logic File (logic.ts)

Contains Zod schemas, types, and processing function:

```typescript
import { z } from "zod";
import { ObsidianRestApiService } from "../../../services/obsidianRestAPI/index.js";
import { VaultCacheService } from "../../../services/obsidianRestAPI/vaultCache/index.js";
import { ObsidianCdpService } from "../../../services/obsidianCdp/index.js";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import { RequestContext, logger } from "../../../utils/index.js";

// Input schema with Zod
export const MyToolInputSchema = z.object({
  filePath: z.string().describe("Path to the note"),
  content: z.string().describe("Content to append"),
  useCdp: z.boolean().optional().default(true).describe("Use CDP if available"),
});

export type MyToolInput = z.infer<typeof MyToolInputSchema>;

// Response interface
export interface MyToolResponse {
  success: boolean;
  source: "cdp" | "rest";
  message: string;
}

// Processing function
export const processMyTool = async (
  params: MyToolInput,
  context: RequestContext,
  obsidianService: ObsidianRestApiService,
  vaultCacheService: VaultCacheService | undefined,
  cdpService: ObsidianCdpService | undefined,
): Promise<MyToolResponse> => {
  const { filePath, content, useCdp } = params;

  // Prefer CDP if available and requested
  if (useCdp && cdpService?.isConnected()) {
    const result = await cdpService.evaluate(
      `
      const file = app.vault.getAbstractFileByPath("${filePath}");
      if (!file) throw new Error("File not found");
      await app.vault.append(file, "${content}");
      return { success: true };
    `,
      context,
    );

    return {
      success: true,
      source: "cdp",
      message: "Content appended via CDP",
    };
  }

  // Fall back to REST
  const existing = await obsidianService.getFileContent(filePath, context);
  await obsidianService.putFileContent(filePath, existing + content, context);

  return {
    success: true,
    source: "rest",
    message: "Content appended via REST",
  };
};
```

### 2. Registration File (registration.ts)

Handles MCP registration and error handling:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ObsidianRestApiService,
  VaultCacheService,
} from "../../../services/obsidianRestAPI/index.js";
import { ObsidianCdpService } from "../../../services/obsidianCdp/index.js";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import {
  ErrorHandler,
  logger,
  RequestContext,
  requestContextService,
} from "../../../utils/index.js";
import {
  MyToolInputSchema,
  MyToolInputSchemaShape,
  processMyTool,
} from "./logic.js";

export const registerMyTool = async (
  server: McpServer,
  obsidianService: ObsidianRestApiService,
  vaultCacheService: VaultCacheService | undefined,
  cdpService: ObsidianCdpService | undefined,
): Promise<void> => {
  const toolName = "my_tool";
  const toolDescription = "Appends content to a note using CDP when available";

  const registrationContext = requestContextService.createRequestContext({
    operation: "RegisterMyTool",
    toolName,
  });

  await ErrorHandler.tryCatch(
    async () => {
      server.tool(
        toolName,
        toolDescription,
        MyToolInputSchemaShape, // Zod schema shape for MCP
        async (params: MyToolInput) => {
          const handlerContext = requestContextService.createRequestContext({
            parentContext: registrationContext,
            operation: "HandleMyToolRequest",
            params: { filePath: params.filePath },
          });

          return await ErrorHandler.tryCatch(
            async () => {
              // Validate with full schema
              const validatedParams = MyToolInputSchema.parse(params);

              const response = await processMyTool(
                validatedParams,
                handlerContext,
                obsidianService,
                vaultCacheService,
                cdpService,
              );

              return {
                content: [
                  { type: "text", text: JSON.stringify(response, null, 2) },
                ],
                isError: false,
              };
            },
            {
              operation: `processing ${toolName}`,
              context: handlerContext,
              input: params,
              errorMapper: (error) =>
                new McpError(
                  error instanceof McpError
                    ? error.code
                    : BaseErrorCode.INTERNAL_ERROR,
                  `Error in ${toolName}: ${error instanceof Error ? error.message : "Unknown"}`,
                ),
            },
          );
        },
      );
    },
    {
      operation: `registering ${toolName}`,
      context: registrationContext,
      errorCode: BaseErrorCode.INTERNAL_ERROR,
      critical: true,
    },
  );
};
```

### 3. Index File (index.ts)

Simple re-export:

```typescript
export { registerMyTool } from "./registration.js";
```

### 4. Server Registration

Add to `src/mcp-server/server.ts`:

```typescript
import { registerMyTool } from "./tools/obsidianMyTool/index.js";

// In createMcpServerInstance(), add:
await registerMyTool(server, obsidianService, vaultCacheService, cdpService);
```

## CDP Service Usage

### When to Use CDP

Use CDP for:

- **Dataview queries** (DQL/DataviewJS) - `obsidianDataviewTool`
- **Metadata cache access** - Fast vault-wide metadata via `app.metadataCache`
- **Native file operations** - O(1) moves with `app.vault.rename()`
- **UI control** - Click, type, scroll, screenshots
- **Plugin access** - Direct access to Dataview, Templater, etc.

### CDP Evaluation Pattern

```typescript
// Use CdpEvaluator for safe execution
import { CdpEvaluator } from "../../../services/obsidianCdp/index.js";

const evaluator = new CdpEvaluator(cdpService);

// Simple evaluation
const result = await evaluator.evaluateWithSafety(
  `
  app.vault.getMarkdownFiles().length
`,
  false,
  context,
);

// Dataview query
const dvResult = await evaluator.executeDataviewQuery(
  'LIST FROM #project WHERE status = "active"',
  context,
);
```

### CDP Error Handling

Always check CDP availability before use:

```typescript
if (!cdpService?.isConnected()) {
  throw new McpError(
    BaseErrorCode.SERVICE_UNAVAILABLE,
    "This tool requires CDP. Start Obsidian with --remote-debugging-port=9222",
  );
}
```

## Configuration System

### Environment Variables

Key config values from `src/config/index.ts`:

```typescript
// Connection
OBSIDIAN_API_KEY              # REST API key (required)
OBSIDIAN_BASE_URL             # Default: http://127.0.0.1:27123
OBSIDIAN_VAULT_PATH           # Absolute path to vault

// CDP
OBSIDIAN_CDP_ENABLED          # Enable CDP mode (default: false)
OBSIDIAN_CDP_PORT             # Default: 9222

// Safety
WRITE_MODE                    # off | safe | confirm | full
BACKUP_ENABLED                # Auto-backup before writes
BACKUP_RETENTION_DAYS         # Default: 30
CONFLICT_DETECTION            # Detect recent modifications

// Server
MCP_TRANSPORT_TYPE            # stdio | http
MCP_HTTP_PORT                 # Default: 3010
MCP_LOG_LEVEL                 # debug | info | warn | error
```

### Accessing Config

```typescript
import { config } from "../../config/index.js";

const writeMode = config.writeMode;
const isCdpEnabled = config.obsidianCdpEnabled;
```

## Safety & Security Patterns

### Write Modes

| Mode      | Behavior                                            |
| --------- | --------------------------------------------------- |
| `off`     | Read-only, no modifications                         |
| `safe`    | Backups before writes, conflict detection (default) |
| `confirm` | Ask user confirmation before every write            |
| `full`    | No restrictions                                     |

### Using SafetyManager

```typescript
import { SafetyManager } from "../../utils/security/SafetyManager.js";

const safety = new SafetyManager();

// Check if write allowed
const check = await safety.checkWritePermission(filePath, context);
if (!check.allowed) {
  throw new McpError(BaseErrorCode.PERMISSION_DENIED, check.reason);
}

// Create backup before write
if (config.backupEnabled) {
  await safety.createBackup(filePath, context);
}

// Check for conflicts
const conflict = await safety.checkConflict(filePath, context);
if (conflict.hasConflict) {
  throw new McpError(
    BaseErrorCode.CONFLICT,
    `File modified ${conflict.secondsSinceModification}s ago. Review before overwriting.`,
  );
}
```

### Error Codes

From `src/types-global/errors.ts`:

```typescript
BaseErrorCode {
  CONNECTION_ERROR      // CDP/REST connection issues
  SERVICE_UNAVAILABLE   // CDP not connected when required
  VALIDATION_ERROR      // Input validation failed
  NOT_FOUND             // File/note not found
  PERMISSION_DENIED     // Write mode restriction
  CONFLICT              // File modified recently
  INTERNAL_ERROR        // Unexpected errors
}
```

## Testing Patterns

### Unit Tests

Tests go in `tests/unit/` using Vitest:

```typescript
import { describe, it, expect, vi } from "vitest";
import { processMyTool } from "../../src/mcp-server/tools/obsidianMyTool/logic.js";

describe("MyTool", () => {
  it("should append content via REST when CDP unavailable", async () => {
    const mockService = {
      getFileContent: vi.fn().mockResolvedValue("# Existing\n"),
      putFileContent: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processMyTool(
      { filePath: "test.md", content: "New", useCdp: true },
      mockContext,
      mockService as any,
      undefined, // vaultCache
      undefined, // cdpService (not connected)
    );

    expect(result.source).toBe("rest");
    expect(mockService.putFileContent).toHaveBeenCalledWith(
      "test.md",
      "# Existing\nNew",
      expect.any(Object),
    );
  });
});
```

### Test Vault Setup

Use the provided script for safe testing:

```bash
./scripts/setup-vaults.sh
```

This creates test vaults in `tests/fixtures/` without touching user data.

### Running Tests

```bash
npm test              # Run all unit tests
npm test -- --watch  # Watch mode
npm run inspect       # MCP Inspector for manual testing
```

## Development Workflow

### Setup

```bash
npm install
npm run build
```

### Configuration

Create `.env`:

```bash
OBSIDIAN_API_KEY=your-api-key
OBSIDIAN_VAULT_PATH=/path/to/test/vault
OBSIDIAN_CDP_ENABLED=true
WRITE_MODE=safe
MCP_LOG_LEVEL=debug
```

### Testing with MCP Inspector

```bash
npm run inspect
```

### Build & Run

```bash
npm run build
npm start
```

## Common Patterns

### Hybrid Tool Decision Tree

```
Tool Called
    ↓
CDP Available? ──No──→ Use REST API
    ↓ Yes
CDP Supports Operation? ──No──→ Use REST API
    ↓ Yes
Execute via CDP
    ↓
Return result with source: "cdp"
```

### Vault Cache Integration

```typescript
// Check cache first
if (vaultCacheService?.isReady()) {
  const cached = vaultCacheService.getCache().get(filePath);
  if (cached) {
    return { content: cached.content, source: "cache" };
  }
}

// Fall back to API
const content = await obsidianService.getFileContent(filePath, context);
```

### File Path Handling

Always normalize paths:

```typescript
import path from "path";

const normalizedPath = path.normalize(filePath).replace(/^\\?/, "");
```

## Troubleshooting

### CDP Connection Issues

**Symptom**: `CDP not connected` errors

**Solutions**:

1. Start Obsidian with: `--remote-debugging-port=9222`
2. Check port isn't in use (only one CDP client allowed)
3. Verify `.env` has `OBSIDIAN_CDP_ENABLED=true`
4. Restart both Obsidian and the MCP server

### Build Errors

```bash
# Clean and rebuild
npm run rebuild
```

### Test Failures

Check for:

- Missing `.env` configuration
- Test vault not set up (run `setup-vaults.sh`)
- Port conflicts with running Obsidian instance

## References

- MCP Specification: https://modelcontextprotocol.io/
- Obsidian Local REST API: https://github.com/coddingtonbear/obsidian-local-rest-api
- CDP Documentation: https://chromedevtools.github.io/devtools-protocol/
- Project Template: https://github.com/cyanheads/mcp-ts-template
