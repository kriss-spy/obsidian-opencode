# Obsidian MCP Skill

Quick reference for developing the obsidian-mcp-server project.

## Quick Start

```bash
# Setup
npm install
npm run build

# Test
npm test
npm run inspect  # MCP Inspector
```

## Adding a New Tool

1. **Create tool directory**:

   ```bash
   mkdir src/mcp-server/tools/obsidianMyTool
   ```

2. **Create files**:
   - `logic.ts` - Zod schemas + business logic
   - `registration.ts` - MCP registration
   - `index.ts` - Re-exports

3. **Register in server** (`src/mcp-server/server.ts`):

   ```typescript
   import { registerMyTool } from "./tools/obsidianMyTool/index.js";
   await registerMyTool(server, obsidianService, vaultCacheService, cdpService);
   ```

4. **Test**:
   ```bash
   npm run build
   npm run inspect
   ```

## Architecture Summary

### Hybrid CDP/REST

- **CDP (Native)**: Dataview, UI control, metadata cache, O(1) file operations
- **REST (Fallback)**: Standard file operations, cross-platform

Tools should prefer CDP when available, fall back to REST.

### Key Services

| Service                  | Purpose                  |
| ------------------------ | ------------------------ |
| `ObsidianRestApiService` | REST API client          |
| `ObsidianCdpService`     | CDP/WebSocket connection |
| `VaultCacheService`      | Local LevelDB cache      |
| `TemplateService`        | Folder templates         |

## Configuration

Key `.env` variables:

```bash
OBSIDIAN_API_KEY=your-key
OBSIDIAN_VAULT_PATH=/path/to/vault
OBSIDIAN_CDP_ENABLED=true
WRITE_MODE=safe  # off | safe | confirm | full
MCP_LOG_LEVEL=debug
```

## Tool Pattern

```typescript
// logic.ts
export const MyToolInputSchema = z.object({
  filePath: z.string(),
});

export const processMyTool = async (
  params: MyToolInput,
  context: RequestContext,
  obsidianService: ObsidianRestApiService,
  vaultCacheService: VaultCacheService | undefined,
  cdpService: ObsidianCdpService | undefined,
): Promise<MyToolResponse> => {
  // Prefer CDP
  if (cdpService?.isConnected()) {
    const result = await cdpService.evaluate(`...`);
    return { source: "cdp", ... };
  }
  // Fall back to REST
  const result = await obsidianService.getFileContent(...);
  return { source: "rest", ... };
};
```

## CDP Usage

```typescript
// Check availability
if (!cdpService?.isConnected()) {
  throw new McpError(BaseErrorCode.SERVICE_UNAVAILABLE, "CDP required");
}

// Evaluate JavaScript
const result = await cdpService.evaluate(
  `
  app.vault.getMarkdownFiles().length
`,
  context,
);

// Use CdpEvaluator for complex operations
import { CdpEvaluator } from "../../../services/obsidianCdp/index.js";
const evaluator = new CdpEvaluator(cdpService);
const dvResult = await evaluator.executeDataviewQuery(
  "LIST FROM #tag",
  context,
);
```

## Error Handling

```typescript
import { ErrorHandler } from "../../../utils/index.js";

await ErrorHandler.tryCatch(
  async () => {
    /* logic */
  },
  {
    operation: "myOperation",
    context,
    errorMapper: (error) =>
      new McpError(BaseErrorCode.INTERNAL_ERROR, error.message),
  },
);
```

## Common Commands

```bash
# Development
npm run build           # Compile TypeScript
npm run rebuild         # Clean + build
npm start               # Start server

# Testing
npm test                # Unit tests
npm run inspect         # MCP Inspector
npm run inspect:stdio   # Inspector (stdio mode)
npm run inspect:http    # Inspector (HTTP mode)

# Utilities
npm run format          # Prettier formatting
npm run tree            # Project tree view
```

## Project Structure

```
src/
├── mcp-server/
│   ├── server.ts              # Main entry point
│   ├── tools/                 # Tool implementations
│   │   └── obsidian[Name]Tool/
│   │       ├── index.ts
│   │       ├── registration.ts
│   │       └── logic.ts
│   └── transports/            # stdio / HTTP
├── services/
│   ├── obsidianRestAPI/       # REST client
│   ├── obsidianCdp/           # CDP bridge
│   └── templateService.ts
├── utils/
│   ├── security/              # SafetyManager
│   ├── obsidian/              # Dataview, LinkExtractor
│   └── index.ts
├── config/
│   └── index.ts               # Environment config
└── types-global/
    └── errors.ts              # Error codes
```

## Safety Modes

| Mode      | Behavior                               |
| --------- | -------------------------------------- |
| `off`     | Read-only                              |
| `safe`    | Backups + conflict detection (default) |
| `confirm` | User confirmation required             |
| `full`    | No restrictions                        |

## Troubleshooting

**CDP not connected**:

- Start Obsidian with `--remote-debugging-port=9222`
- Check port 9222 isn't in use
- Verify `OBSIDIAN_CDP_ENABLED=true`

**Build errors**:

```bash
npm run rebuild
```

**Test failures**:

```bash
./scripts/setup-vaults.sh  # Setup test vaults
```

## See Also

- Full skill guide: `SKILL.md`
- Detailed references: `references/`
- Project README: `/README.md`
