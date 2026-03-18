export const BASH_TOOL_DESCRIPTION = `Executes a shell command with optional timeout.

Use local_shell as the default tool for:
- repository search and inspection
- listing files and directories
- build, test, lint, and git commands
- focused environment checks

Do not treat local_shell-only exploration as the default for broad, open-ended, project-wide analysis when the work can be split into independent branches.

Prefer other tools when available:
- use read_file when you already know the file path
- use file_edit for precise edits to existing files
- use write_file for full-file writes
- use the agent tool only for genuinely multi-step delegated work

Platform guidance:
- Windows: prefer PowerShell command shapes such as Get-ChildItem, Get-Content, Select-String, and direct git/npm commands
- macOS/Linux: prefer rg, rg --files, ls, cat, find, and shell pipelines

Search guidance:
- Prefer rg for text search and rg --files for file discovery when available
- Prefer absolute or workspace-relative paths
- Avoid unnecessary cd usage when workdir can be set directly

Execution guidance:
- Use parallel shell calls for independent commands
- Use && only when later commands depend on earlier ones
- Use runInBackground only for genuinely long-running commands
- Do not append & manually when runInBackground=true

Examples:
- Windows search: Get-ChildItem -Path src -Recurse | Select-String -Pattern 'TODO'
- Windows read: Get-Content -Raw package.json
- Unix search: rg "local_shell" src
- Unix file discovery: rg --files src
- Git status: git status && git diff --stat`;

export const FILE_READ_TOOL_DESCRIPTION = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the user provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The path parameter must be an absolute path, not a relative path
- By default, it reads up to 1000 lines starting from the beginning of the file
- You can optionally specify a startLine (0-based) and limit (number of lines to read) for line-based slicing
- startLine: The line number to start reading from (0-based, defaults to 0)
- limit: The number of lines to read (defaults to 1000)
- Any lines longer than 2000 characters will be truncated
- Results are returned with line numbers
- You have the capability to call multiple tools in a single response. It is often better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
- You can read image files using this tool.
`;

export const FILE_EDIT_TOOL_DESCRIPTION = `Apply one or more old/new text replacements to a single file and return a unified diff.

Recommended workflow:
1. Read latest content with read_file.
2. Build all intended replacements in one file_edit call.
3. Use dryRun=true to preview before writing when risk is high.

Notes:
- Edits are applied in order.
- If oldText is not found, the tool returns EDIT_CONFLICT so you can re-read and retry.
- This is preferred over write_file for precise incremental edits to existing files.`;

export const FILE_HISTORY_LIST_TOOL_DESCRIPTION = `Lists saved historical versions for a file.

Use this when:
- You want to see whether a previous version is available before restoring.
- You need a versionId for a later file_history_restore call.

Notes:
- Results are ordered newest-first.
- Each entry includes versionId, createdAt, size, and source.`;

export const FILE_HISTORY_RESTORE_TOOL_DESCRIPTION = `Restores a file from previously saved history.

Use this when:
- You need to roll back a file to a prior saved version.
- The user asks to restore the previous or a specific old version.

Usage notes:
- Provide path and, optionally, versionId.
- If versionId is omitted, the latest saved version is restored.
- Restoring also preserves the current file content as a new history snapshot before overwrite.`;

export const WRITE_FILE_TOOL_DESCRIPTION = `Writes file content to the local filesystem.

Behavior:
- direct mode writes content immediately.
- direct mode buffers the full payload when it exceeds the chunk limit and returns a bufferId.
- finalize mode commits buffered content to the target file and can resolve the target path from bufferId.

Usage notes:
- Prefer editing existing files with file_edit when possible.
- Use write_file when replacing full content or when buffered large writes are required.
- Always include path on direct writes, and put "path" before "content" when generating large JSON arguments.
- Provide plain text content directly, not Markdown code fences.
- Avoid creating new documentation files unless the user explicitly asks.`;

export const TASK_TOOL_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks autonomously.

The agent tool launches specialized subagents that autonomously handle complex work. Each subagent type has a specific role and an explicit tool allowlist.

Available subagent types and their default tools:
- Bash: terminal and command execution specialist. Use for focused shell work. (Tools: local_shell)
- general-purpose: broad multi-step research and implementation agent. Use when the task may require several rounds of searching, reading, editing, and verification. (Tools: local_shell, read_file, file_edit, write_file, file_history_list, file_history_restore, skill, web_fetch, web_search)
- Explore: fast codebase exploration and discovery agent. Use for open-ended codebase exploration and multi-round keyword searches. (Tools: local_shell, read_file, skill)
- Restore: focused rollback agent for restoring a file from saved history when the parent agent already knows the target path. (Tools: local_shell, read_file, file_history_list, file_history_restore)
- Plan: implementation planning and architecture strategy agent. Use when you need a concrete implementation plan, critical file list, risks, and trade-offs before editing code. (Tools: local_shell, read_file, skill)
- research-agent: long-form research and synthesis agent. Use when you need evidence collection and structured findings from local project context. (Tools: local_shell, read_file, skill, web_fetch, web_search)
- find-skills: local skill lookup + installation guidance agent. Use to discover the right skill, prefer local skills first, and fall back to verified installation steps when needed. (Tools: skill, local_shell)

When to use the agent tool:
- Complex, multi-step work that benefits from delegation.
- Open-ended exploration or research that will likely take multiple searches.
- Parallel, independent branches of investigation.
- Broad codebase search only when you are not confident a direct local_shell query will find the right match in the first few tries.
- Project-wide analysis, architecture review, risk audit, or "deeply analyze this repository" style requests after a quick decomposition step identifies independent branches.
- Requests such as "deeply analyze the current project", "analyze this repository", "audit this codebase", "review the architecture", "identify major risks", "全面分析当前项目", or "深度分析当前项目" unless the user explicitly asks for single-agent handling.

When NOT to use the agent tool:
- If you already know the file path, use read_file.
- If you need direct search or file discovery yourself, prefer local_shell.
- If you only need to inspect one file or a small known set of files, use direct tools instead.

Usage notes:
- Always include a short description (3-5 words) summarizing the subagent run.
- Always set role explicitly to the agent you want.
- For open-ended project-wide analysis, decompose first; if there are 2 or more independent branches, you must launch subagents for those branches instead of keeping all investigation in the parent agent.
- For strong-trigger analysis requests, prefer launching at least 2 subagents when independent branches exist and spawn_agent is available.
- Use the parent agent for orchestration and synthesis, not as the only investigator.
- The parent agent should own decomposition, branch assignment, and final synthesis.
- Use foreground execution when you need the result before continuing.
- Use runInBackground=true only when the work is genuinely independent.
- For background runs, use task_output to retrieve status/output later and task_stop to cancel when needed.
- Launch multiple task calls in parallel when the work is independent.
- The subagent result is returned to you through the tool response; summarize relevant findings to the user.
- Provide a clear prompt that states whether the subagent should research only or also make code changes.
- If you decide not to spawn subagents for a complex open-ended task, make that decision explicit and give the reason.
- Do not treat a handful of parent-agent shell searches as sufficient for a strong-trigger analysis request unless a skip condition clearly applies.
- For direct needle queries, prefer direct tools first (local_shell/read_file/file_edit).
- Default workflow: use local_shell to locate candidates, read_file to inspect exact files, and file_edit or write_file only when you are ready to change code.`;

export const TASK_CREATE_DESCRIPTION = `Use this tool to create a structured task list entry for the current coding session.

When to use:
- Multi-step implementation work.
- Non-trivial tasks that benefit from explicit tracking.
- User requests a todo/task list.
- You need clearer progress visibility for the user.

Task fields:
- subject: imperative short title.
- description: detailed task context and acceptance criteria.
- activeForm: present-continuous text shown while in progress.`;

export const TASK_GET_DESCRIPTION = `Retrieve a task by ID from the task list.

Use this to:
- Read full task requirements before execution.
- Inspect dependency and blocker information.
- Decide whether a task can start now.`;

export const TASK_LIST_DESCRIPTION = `List tasks in the namespace with summary state.

Use this to:
- Find available work items.
- Review overall progress and blocked tasks.
- Pick the next task after finishing current work.

Tip:
- Prefer lower-ID tasks first when multiple tasks are available.`;

export const TASK_UPDATE_DESCRIPTION = `Update a task in the task list.

Use this to:
- Move task status through workflow.
- Update subject/description/owner/progress/metadata.
- Add or remove dependency edges.
- Mark tasks completed, failed, cancelled, or back to pending when appropriate.

Best practice:
- Read the latest task state before updating to avoid stale writes.`;

export const TASK_STOP_DESCRIPTION = `Stop a running subagent execution by agentId or linked taskId.

Usage:
- Provide agentId directly when available.
- Or provide taskId to resolve the linked agent run.
- Optionally cancel linked planning tasks in the same call.`;

export const TASK_OUTPUT_DESCRIPTION = `Retrieve output from a running or completed task.

Use this tool to inspect:
- background shell runs via taskId
- linked subagent runs via taskId
- direct subagent runs via agentId

Usage notes:
- Provide taskId or agentId.
- Use block=true (default) to wait for completion.
- Use block=false for a non-blocking status check.
- Returns status, output, and wait metadata when available.`;

export const SKILL_TOOL_BASE_DESCRIPTION = `Load a skill to get detailed task-specific instructions.
Skills contain specialized workflows and reusable operational context.`;

export const SKILL_FIND_TOOL_DESCRIPTION = `Automatically find the most relevant skill for a user request.

Usage:
- Provide query with the task intent or requirement.
- topK controls how many ranked candidates are returned (default 5).
- minScore filters weak matches (default 0.1).
- autoLoad=true returns full matched skill content in the same call.

When to use:
- User asks "which skill should I use?".
- Skill name is unknown but task intent is clear.
- You need ranked skill suggestions before loading one manually.`;

export const WEB_FETCH_TOOL_DESCRIPTION = `Fetches content from a URL with SSRF protection.

Features:
- Extract modes: text (plain text), markdown (simplified), html (raw)
- SSRF protection blocks localhost, private IPs, and cloud metadata endpoints
- Response size limit: 5MB
- Configurable timeout (default 30s, max 120s)

Usage notes:
- url is required and must be a valid HTTP/HTTPS URL
- extractMode defaults to 'text' for clean plain text extraction
- maxChars limits output length (default 30000, max 100000)
- Internal/private network addresses are blocked for security`;

export const WEB_SEARCH_TOOL_DESCRIPTION = `Performs a web search using Tavily or Brave Search API.

Requires one of these environment variables:
- TAVILY_API_KEY for Tavily search
- BRAVE_SEARCH_API_KEY for Brave Search

Usage notes:
- query is required (1-500 characters)
- maxResults controls result count (1-10, default 5)
- provider can be 'tavily', 'brave', or 'auto' (default)
- 'auto' uses the first available API key

Results include title, URL, snippet, and relevance score.`;

export const LSP_TOOL_DESCRIPTION = `TypeScript Language Service operations for code intelligence.

Supported operations:
- goToDefinition: Jump to symbol definition
- findReferences: Find all references to a symbol
- hover: Get type information and documentation
- documentSymbols: List all symbols in a file

Usage notes:
- filePath is required (absolute or relative path)
- line and character are 1-based (editor-style)
- line and character are required for goToDefinition, findReferences, and hover
- Supports .ts, .tsx, .js, .jsx, .mjs, .cjs files
- Uses TypeScript Compiler API for accurate results
- Respects tsconfig.json when present`;
