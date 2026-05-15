# Tool Implementation Patterns

Comprehensive patterns for implementing tools in obsidian-mcp-server.

## File Structure Pattern

Every tool must follow this structure:

```
tools/obsidian[ToolName]Tool/
├── index.ts           # Public exports
├── registration.ts    # MCP registration
├── logic.ts           # Business logic + schemas
└── [logic].test.ts    # Unit tests (optional)
```

## Complete Tool Example

Here's a complete hybrid tool that demonstrates all patterns:

### logic.ts

```typescript
import { z } from "zod";
import { ObsidianRestApiService } from "../../../services/obsidianRestAPI/index.js";
import { VaultCacheService } from "../../../services/obsidianRestAPI/vaultCache/index.js";
import { ObsidianCdpService } from "../../../services/obsidianCdp/index.js";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import { RequestContext, logger } from "../../../utils/index.js";

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const ObsidianAppendInputSchema = z.object({
  filePath: z
    .string()
    .describe("The path to the note (relative to vault root)."),

  content: z.string().describe("The content to append to the note."),

  prependNewline: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to prepend a newline before the content."),

  useCdp: z
    .boolean()
    .optional()
    .default(true)
    .describe("Use CDP if available for better performance."),
});

// Export type for TypeScript
export type ObsidianAppendInput = z.infer<typeof ObsidianAppendInputSchema>;

// Export shape for MCP registration (strips .describe() calls)
export const ObsidianAppendInputSchemaShape = ObsidianAppendInputSchema.shape;

// ============================================================================
// RESPONSE TYPE
// ============================================================================

export interface ObsidianAppendResponse {
  success: boolean;
  message: string;
  source: "cdp" | "rest";
  fileStats?: {
    path: string;
    size: number;
    modified: string;
  };
}

// ============================================================================
// MAIN PROCESSING FUNCTION
// ============================================================================

export const processObsidianAppend = async (
  params: ObsidianAppendInput,
  context: RequestContext,
  obsidianService: ObsidianRestApiService,
  vaultCacheService: VaultCacheService | undefined,
  cdpService: ObsidianCdpService | undefined,
): Promise<ObsidianAppendResponse> => {
  const { filePath, content, prependNewline, useCdp } = params;
  const startTime = Date.now();

  logger.debug("Processing append request", {
    ...context,
    filePath,
    contentLength: content.length,
  });

  // ========================================================================
  // CDP PATH (Preferred)
  // ========================================================================

  if (useCdp && cdpService?.isConnected()) {
    try {
      // Escape content for JavaScript string
      const escapedContent = content
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");

      const newlinePrefix = prependNewline ? "\\n" : "";

      const result = await cdpService.evaluate(
        `
        (async () => {
          const file = app.vault.getAbstractFileByPath("${filePath}");
          if (!file) {
            return { success: false, error: "File not found" };
          }
          
          const currentContent = await app.vault.cachedRead(file);
          const newContent = currentContent + "${newlinePrefix}${escapedContent}";
          
          await app.vault.modify(file, newContent);
          
          return { 
            success: true, 
            size: newContent.length,
            modified: Date.now()
          };
        })()
      `,
        context,
      );

      if (!result.success) {
        throw new McpError(
          BaseErrorCode.NOT_FOUND,
          result.error || "Failed to append via CDP",
        );
      }

      logger.debug(
        `Append via CDP completed in ${Date.now() - startTime}ms`,
        context,
      );

      return {
        success: true,
        message: `Appended ${content.length} characters via CDP`,
        source: "cdp",
        fileStats: {
          path: filePath,
          size: result.size,
          modified: new Date(result.modified).toISOString(),
        },
      };
    } catch (error) {
      // Log CDP failure but don't throw - try REST fallback
      logger.warning(
        `CDP append failed, falling back to REST: ${error instanceof Error ? error.message : String(error)}`,
        context,
      );
    }
  }

  // ========================================================================
  // REST PATH (Fallback)
  // ========================================================================

  try {
    // Get current content
    const currentContent = await obsidianService.getFileContent(
      filePath,
      context,
    );

    // Append new content
    const separator = prependNewline ? "\n" : "";
    const newContent = currentContent + separator + content;

    // Write back
    await obsidianService.putFileContent(filePath, newContent, context);

    logger.debug(
      `Append via REST completed in ${Date.now() - startTime}ms`,
      context,
    );

    return {
      success: true,
      message: `Appended ${content.length} characters via REST`,
      source: "rest",
      fileStats: {
        path: filePath,
        size: newContent.length,
        modified: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to append content: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
};
```

### registration.ts

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
  ObsidianAppendInput,
  ObsidianAppendInputSchema,
  ObsidianAppendInputSchemaShape,
  ObsidianAppendResponse,
  processObsidianAppend,
} from "./logic.js";

export const registerObsidianAppendTool = async (
  server: McpServer,
  obsidianService: ObsidianRestApiService,
  vaultCacheService: VaultCacheService | undefined,
  cdpService: ObsidianCdpService | undefined,
): Promise<void> => {
  const toolName = "obsidian_append";
  const toolDescription =
    "Appends content to an Obsidian note. Uses CDP for instant O(1) " +
    "operations when available, falls back to REST API. Returns success " +
    "status, operation source (cdp/rest), and updated file stats.";

  // Create registration context
  const registrationContext: RequestContext =
    requestContextService.createRequestContext({
      operation: "RegisterObsidianAppendTool",
      toolName,
    });

  logger.info(`Attempting to register tool: ${toolName}`, registrationContext);

  await ErrorHandler.tryCatch(
    async () => {
      server.tool(
        toolName,
        toolDescription,
        ObsidianAppendInputSchemaShape,
        async (params: ObsidianAppendInput) => {
          // Create handler context with parent reference
          const handlerContext: RequestContext =
            requestContextService.createRequestContext({
              parentContext: registrationContext,
              operation: "HandleObsidianAppendRequest",
              toolName,
              params: {
                filePath: params.filePath,
                contentLength: params.content.length,
              },
            });

          logger.debug(`Handling '${toolName}' request`, handlerContext);

          return await ErrorHandler.tryCatch(
            async () => {
              // Validate with full Zod schema
              const validatedParams = ObsidianAppendInputSchema.parse(params);

              // Execute business logic
              const response: ObsidianAppendResponse =
                await processObsidianAppend(
                  validatedParams,
                  handlerContext,
                  obsidianService,
                  vaultCacheService,
                  cdpService,
                );

              logger.debug(
                `'${toolName}' processed successfully`,
                handlerContext,
              );

              // Return MCP-formatted result
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(response, null, 2),
                  },
                ],
                isError: false,
              };
            },
            {
              operation: `processing ${toolName}`,
              context: handlerContext,
              input: params,
              errorMapper: (error: unknown) =>
                new McpError(
                  error instanceof McpError
                    ? error.code
                    : BaseErrorCode.INTERNAL_ERROR,
                  `Error processing ${toolName}: ${error instanceof Error ? error.message : "Unknown error"}`,
                ),
            },
          );
        },
      );

      logger.info(
        `Tool registered successfully: ${toolName}`,
        registrationContext,
      );
    },
    {
      operation: `registering ${toolName}`,
      context: registrationContext,
      errorCode: BaseErrorCode.INTERNAL_ERROR,
      errorMapper: (error: unknown) =>
        new McpError(
          error instanceof McpError ? error.code : BaseErrorCode.INTERNAL_ERROR,
          `Failed to register '${toolName}': ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      critical: true,
    },
  );
};
```

### index.ts

```typescript
export { registerObsidianAppendTool } from "./registration.js";
```

## Input Validation Patterns

### Required vs Optional Fields

```typescript
const Schema = z.object({
  // Required - no .optional()
  filePath: z.string(),

  // Optional with default
  limit: z.number().optional().default(100),

  // Optional without default
  offset: z.number().optional(),

  // Optional boolean (undefined is falsy)
  useCdp: z.boolean().optional(),
});
```

### String Validation

```typescript
const Schema = z.object({
  // Non-empty string
  filePath: z.string().min(1),

  // Pattern matching
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  // Enum values
  mode: z.enum(["read", "write", "append"]),

  // Custom validation
  tag: z
    .string()
    .refine((val) => val.startsWith("#"), { message: "Tag must start with #" }),
});
```

### Array Validation

```typescript
const Schema = z.object({
  // Array of strings
  tags: z.array(z.string()),

  // Non-empty array
  replacements: z.array(ReplacementSchema).min(1),

  // Array with max length
  files: z.array(z.string()).max(100),
});
```

### Complex Objects

```typescript
const ReplacementSchema = z.object({
  search: z.string(),
  replace: z.string(),
  useRegex: z.boolean().optional().default(false),
});

const Schema = z.object({
  filePath: z.string(),
  replacements: z.array(ReplacementSchema),
});
```

## Error Handling Patterns

### Service Unavailability

```typescript
if (!cdpService?.isConnected()) {
  throw new McpError(
    BaseErrorCode.SERVICE_UNAVAILABLE,
    "This tool requires CDP. Start Obsidian with --remote-debugging-port=9222",
  );
}
```

### Not Found

```typescript
const file = await obsidianService.getFileContent(path, context);
if (!file) {
  throw new McpError(BaseErrorCode.NOT_FOUND, `File not found: ${path}`);
}
```

### Validation Error

```typescript
const result = Schema.safeParse(params);
if (!result.success) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    `Invalid parameters: ${result.error.message}`,
  );
}
```

### Permission Denied

```typescript
if (config.writeMode === "off") {
  throw new McpError(
    BaseErrorCode.PERMISSION_DENIED,
    "Write operations are disabled (WRITE_MODE=off)",
  );
}
```

## Response Patterns

### Standard Success Response

```typescript
return {
  success: true,
  message: "Operation completed successfully",
  source: "cdp", // or "rest"
  data: {
    /* ... */
  },
};
```

### Paginated Response

```typescript
return {
  items: results.slice(offset, offset + limit),
  total: results.length,
  limit,
  offset,
  hasMore: offset + limit < results.length,
};
```

### File Stats Response

```typescript
return {
  file: {
    path: filePath,
    size: content.length,
    modified: stat.mtime.toISOString(),
    created: stat.birthtime.toISOString(),
  },
  content: returnContent ? content : undefined,
};
```

## Logging Patterns

### Debug Logging

```typescript
logger.debug("Processing request", {
  ...context,
  param1: value1,
  param2: value2,
});
```

### Info Logging

```typescript
logger.info(`Operation completed in ${duration}ms`, context);
```

### Warning Logging

```typescript
logger.warning("CDP failed, falling back to REST", {
  ...context,
  error: error.message,
});
```

### Error Logging

```typescript
logger.error("Operation failed", error, context);
```

## Testing Patterns

### Mock Services

```typescript
const createMockObsidianService = () => ({
  getFileContent: vi.fn(),
  putFileContent: vi.fn(),
  postFileContent: vi.fn(),
  deleteFile: vi.fn(),
});

const createMockCdpService = (connected = true) => ({
  isConnected: vi.fn().mockReturnValue(connected),
  evaluate: vi.fn(),
  sendRawCommand: vi.fn(),
});

const createMockVaultCacheService = () => ({
  isReady: vi.fn().mockReturnValue(true),
  getCache: vi.fn().mockReturnValue(new Map()),
});
```

### Test Structure

```typescript
describe("ObsidianAppendTool", () => {
  const mockContext = { operation: "test", requestId: "test-123" };

  it("should append via CDP when available", async () => {
    const mockCdp = createMockCdpService(true);
    mockCdp.evaluate.mockResolvedValue({
      success: true,
      size: 100,
      modified: Date.now(),
    });

    const result = await processObsidianAppend(
      { filePath: "test.md", content: "Hello", useCdp: true },
      mockContext,
      createMockObsidianService(),
      undefined,
      mockCdp,
    );

    expect(result.source).toBe("cdp");
    expect(result.success).toBe(true);
  });

  it("should fall back to REST when CDP unavailable", async () => {
    const mockObsidian = createMockObsidianService();
    mockObsidian.getFileContent.mockResolvedValue("Existing");
    mockObsidian.putFileContent.mockResolvedValue(undefined);

    const result = await processObsidianAppend(
      { filePath: "test.md", content: "Hello", useCdp: true },
      mockContext,
      mockObsidian,
      undefined,
      createMockCdpService(false),
    );

    expect(result.source).toBe("rest");
    expect(mockObsidian.putFileContent).toHaveBeenCalled();
  });
});
```
