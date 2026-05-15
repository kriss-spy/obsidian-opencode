# Error Handling Guide

Comprehensive guide to error handling in obsidian-mcp-server.

## Error Hierarchy

```
Error (base)
├── McpError (project-specific)
│   ├── BaseErrorCode
│   └── Custom context
├── ZodError (validation)
│   └── Schema parsing failures
├── ConnectionError
│   ├── CDP connection failures
│   └── REST API failures
└── ServiceError
    ├── Vault cache errors
    └── Template service errors
```

## McpError Class

Located in `src/types-global/errors.ts`:

```typescript
export enum BaseErrorCode {
  // Connection Issues
  CONNECTION_ERROR = "CONNECTION_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  TIMEOUT = "TIMEOUT",

  // Request Issues
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  CONFLICT = "CONFLICT",
  RATE_LIMITED = "RATE_LIMITED",

  // Server Issues
  INTERNAL_ERROR = "INTERNAL_ERROR",
  EXECUTION_ERROR = "EXECUTION_ERROR",
}

export class McpError extends Error {
  constructor(
    public code: BaseErrorCode,
    message: string,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = "McpError";
  }
}
```

## ErrorHandler Utility

The `ErrorHandler` class provides standardized error handling:

```typescript
import { ErrorHandler } from "../../../utils/index.js";

await ErrorHandler.tryCatch(
  async () => {
    // Your async operation
    return result;
  },
  {
    operation: "descriptiveOperationName",
    context, // RequestContext for logging
    input: params, // Input data for debugging
    errorCode: BaseErrorCode.INTERNAL_ERROR, // Default error code
    errorMapper: (error) => {
      // Custom error transformation
      if (error instanceof McpError) {
        return error; // Pass through McpErrors
      }
      return new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Operation failed: ${error.message}`,
      );
    },
    critical: false, // If true, logs as fatal error
  },
);
```

## Error Patterns by Scenario

### 1. Connection Errors

**CDP Not Connected**

```typescript
if (!cdpService?.isConnected()) {
  throw new McpError(
    BaseErrorCode.SERVICE_UNAVAILABLE,
    "CDP connection required. Start Obsidian with --remote-debugging-port=9222",
    { toolName: "obsidian_dataview" },
  );
}
```

**REST API Connection Failure**

```typescript
try {
  await obsidianService.checkStatus(context);
} catch (error) {
  throw new McpError(
    BaseErrorCode.CONNECTION_ERROR,
    "Cannot connect to Obsidian REST API. Is the Local REST API plugin enabled?",
    { baseUrl: config.obsidianBaseUrl },
  );
}
```

### 2. Validation Errors

**Zod Schema Validation**

```typescript
const result = MyInputSchema.safeParse(params);
if (!result.success) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    `Invalid input: ${result.error.issues.map((i) => i.message).join(", ")}`,
    { issues: result.error.issues },
  );
}

// Or use parse() and catch ZodError
try {
  const validated = MyInputSchema.parse(params);
} catch (error) {
  if (error instanceof ZodError) {
    throw new McpError(BaseErrorCode.VALIDATION_ERROR, error.message, {
      errors: error.errors,
    });
  }
  throw error;
}
```

**Business Logic Validation**

```typescript
if (params.limit > 1000) {
  throw new McpError(
    BaseErrorCode.VALIDATION_ERROR,
    "Limit cannot exceed 1000",
    { provided: params.limit, max: 1000 },
  );
}
```

### 3. Not Found Errors

**File Not Found**

```typescript
const content = await obsidianService.getFileContent(path, context);
if (content === null || content === undefined) {
  throw new McpError(BaseErrorCode.NOT_FOUND, `File not found: ${path}`, {
    filePath: path,
  });
}
```

**CDP File Not Found**

```typescript
const result = await cdpService.evaluate(
  `
  const file = app.vault.getAbstractFileByPath("${path}");
  if (!file) return { notFound: true };
  // ...
`,
  context,
);

if (result?.notFound) {
  throw new McpError(BaseErrorCode.NOT_FOUND, `File not found: ${path}`);
}
```

### 4. Permission Errors

**Write Mode Restriction**

```typescript
if (config.writeMode === "off") {
  throw new McpError(
    BaseErrorCode.PERMISSION_DENIED,
    "Write operations disabled (WRITE_MODE=off)",
  );
}
```

**Protected Patterns**

```typescript
const isProtected = config.protectedPatterns.some((pattern) =>
  minimatch(filePath, pattern),
);

if (isProtected) {
  throw new McpError(
    BaseErrorCode.PERMISSION_DENIED,
    `File matches protected pattern: ${filePath}`,
    { protectedPatterns: config.protectedPatterns },
  );
}
```

### 5. Conflict Errors

**Sync Conflict Detection**

```typescript
const fileStat = await obsidianService.getFileStats(filePath, context);
const lastModified = new Date(fileStat.mtime);
const secondsSinceModification = (Date.now() - lastModified.getTime()) / 1000;

if (secondsSinceModification < config.syncBufferSeconds) {
  throw new McpError(
    BaseErrorCode.CONFLICT,
    `File modified ${secondsSinceModification.toFixed(0)}s ago. ` +
      `Wait ${config.syncBufferSeconds}s or use force=true`,
    {
      lastModified: lastModified.toISOString(),
      secondsSinceModification,
      syncBufferSeconds: config.syncBufferSeconds,
    },
  );
}
```

### 6. Execution Errors

**CDP JavaScript Errors**

```typescript
try {
  const result = await cdpService.evaluate(
    `
    throw new Error("Something went wrong");
  `,
    context,
  );
} catch (error) {
  if (
    error instanceof McpError &&
    error.code === BaseErrorCode.EXECUTION_ERROR
  ) {
    // Handle JavaScript execution error
    logger.error("CDP execution failed", error, context);
    throw new McpError(
      BaseErrorCode.EXECUTION_ERROR,
      `Obsidian execution error: ${error.message}`,
    );
  }
  throw error;
}
```

**Dataview Query Errors**

```typescript
const result = await evaluator.executeDataviewQuery(query, context);

if (!result.success) {
  throw new McpError(
    BaseErrorCode.EXECUTION_ERROR,
    `Dataview query failed: ${result.error}`,
    { query, error: result.error },
  );
}
```

### 7. Timeout Errors

```typescript
const TIMEOUT_MS = 30000;

try {
  const result = await Promise.race([
    performOperation(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS),
    ),
  ]);
} catch (error) {
  if (error.message === "Timeout") {
    throw new McpError(
      BaseErrorCode.TIMEOUT,
      `Operation timed out after ${TIMEOUT_MS}ms`,
      { timeoutMs: TIMEOUT_MS },
    );
  }
  throw error;
}
```

## Error Mapping Patterns

### In Registration Files

```typescript
errorMapper: (error: unknown) => {
  // Preserve McpErrors
  if (error instanceof McpError) {
    return error;
  }

  // Handle specific error types
  if (error instanceof ZodError) {
    return new McpError(
      BaseErrorCode.VALIDATION_ERROR,
      `Validation failed: ${error.message}`,
      { errors: error.errors },
    );
  }

  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) {
      return new McpError(
        BaseErrorCode.NOT_FOUND,
        `Resource not found: ${error.config?.url}`,
      );
    }
    if (error.response?.status === 403) {
      return new McpError(
        BaseErrorCode.PERMISSION_DENIED,
        "Access denied to Obsidian API",
      );
    }
    return new McpError(
      BaseErrorCode.CONNECTION_ERROR,
      `API error: ${error.message}`,
    );
  }

  // Default fallback
  return new McpError(
    BaseErrorCode.INTERNAL_ERROR,
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
};
```

### In Logic Files

```typescript
export const processMyTool = async (...) => {
  try {
    // ... logic
  } catch (error) {
    // Wrap unknown errors
    if (!(error instanceof McpError)) {
      throw new McpError(
        BaseErrorCode.INTERNAL_ERROR,
        `Processing failed: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      );
    }
    throw error;
  }
};
```

## Logging Errors

### Error Logger Levels

```typescript
// Fatal - System cannot continue
logger.fatal("Critical error", error, context);

// Error - Operation failed
logger.error("Operation failed", error, context);

// Warning - Recoverable issue
logger.warning("Fallback to REST", context);

// Debug - Detailed debugging
logger.debug("Error details", { error: error.message, stack: error.stack });
```

### Context Enrichment

Always include relevant context:

```typescript
logger.error("File write failed", error, {
  ...context,
  filePath,
  operation: "write",
  writeMode: config.writeMode,
});
```

## Testing Error Scenarios

```typescript
import { describe, it, expect, vi } from "vitest";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";

describe("Error Handling", () => {
  it("should throw McpError for missing file", async () => {
    const mockService = {
      getFileContent: vi.fn().mockResolvedValue(null),
    };

    await expect(
      processTool({ filePath: "missing.md" }, context, mockService),
    ).rejects.toThrow(McpError);

    await expect(
      processTool({ filePath: "missing.md" }, context, mockService),
    ).rejects.toMatchObject({
      code: BaseErrorCode.NOT_FOUND,
    });
  });

  it("should throw validation error for invalid input", async () => {
    await expect(
      processTool({ filePath: "" }, context, mockService),
    ).rejects.toMatchObject({
      code: BaseErrorCode.VALIDATION_ERROR,
    });
  });
});
```

## Best Practices

1. **Always use McpError**: Wrap all errors in McpError for consistency
2. **Provide context**: Include operation details, inputs, and state
3. **Use appropriate codes**: Choose the right BaseErrorCode
4. **Log before throwing**: Log errors with context before throwing
5. **Don't swallow errors**: Re-throw or transform, never ignore
6. **User-friendly messages**: Error messages should help users fix issues
7. **Include remediation**: Suggest solutions in error messages

## Error Response Format

Tools return errors in MCP format:

```typescript
return {
  content: [
    {
      type: "text",
      text: JSON.stringify(
        {
          success: false,
          error: {
            code: BaseErrorCode.NOT_FOUND,
            message: "File not found: test.md",
            details: { filePath: "test.md" },
          },
        },
        null,
        2,
      ),
    },
  ],
  isError: true,
};
```
