import type {
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  ElicitRequestURLParams,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { UUID } from 'crypto'
import type { z } from 'zod/v4'
import type { Command } from './commands.js'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import type { ThinkingConfig } from './utils/thinking.js'

export type ToolInputJSONSchema = {
  [x: string]: unknown
  type: 'object'
  properties?: {
    [x: string]: unknown
  }
}

import type { Notification } from './context/notifications.js'
import type {
  MCPServerConnection,
  ServerResource,
} from './services/mcp/types.js'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from './tools/AgentTool/loadAgentsDir.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemLocalCommandMessage,
  SystemMessage,
  UserMessage,
} from './types/message.js'
// Import permission types from centralized location to break import cycles
// Import PermissionResult from centralized location to break import cycles
import type {
  AdditionalWorkingDirectory,
  PermissionMode,
  PermissionResult,
} from './types/permissions.js'
// Import tool progress types from centralized location to break import cycles
import type {
  AgentToolProgress,
  BashProgress,
  MCPProgress,
  REPLToolProgress,
  SkillToolProgress,
  TaskOutputProgress,
  ToolProgressData,
  WebSearchProgress,
} from './types/tools.js'
import type { FileStateCache } from './utils/fileStateCache.js'
import type { DenialTrackingState } from './utils/permissions/denialTracking.js'
import type { SystemPrompt } from './utils/systemPromptType.js'
import type { ContentReplacementState } from './utils/toolResultStorage.js'

// Re-export progress types for backwards compatibility
export type {
  AgentToolProgress,
  BashProgress,
  MCPProgress,
  REPLToolProgress,
  SkillToolProgress,
  TaskOutputProgress,
  WebSearchProgress,
}

import type { SpinnerMode } from './components/Spinner.js'
import type { QuerySource } from './constants/querySource.js'
import type { SDKStatus } from './entrypoints/agentSdkTypes.js'
import type { AppState } from './state/AppState.js'
import type {
  HookProgress,
  PromptRequest,
  PromptResponse,
} from './types/hooks.js'
import type { AgentId } from './types/ids.js'
import type { DeepImmutable } from './types/utils.js'
import type { AttributionState } from './utils/commitAttribution.js'
import type { FileHistoryState } from './utils/fileHistory.js'
import type { Theme, ThemeName } from './utils/theme.js'

export type QueryChainTracking = {
  chainId: string
  depth: number
}

export type ValidationResult =
  | { result: true }
  | {
      result: false
      message: string
      errorCode: number
    }

export type SetToolJSXFn = (
  args: {
    jsx: React.ReactNode | null
    shouldHidePromptInput: boolean
    shouldContinueAnimation?: true
    showSpinner?: boolean
    isLocalJSXCommand?: boolean
    isImmediate?: boolean
    /*    * Set to true to clear a local JSX command (e.g., from its onDone callback)     */
    clearLocalJSX?: boolean
  } | null,
) => void

// Import tool permission types from centralized location to break import cycles
import type { ToolPermissionRulesBySource } from './types/permissions.js'

// Re-export for backwards compatibility
export type { ToolPermissionRulesBySource }

// Apply DeepImmutable to the imported type
export type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource
  alwaysDenyRules: ToolPermissionRulesBySource
  alwaysAskRules: ToolPermissionRulesBySource
  isBypassPermissionsModeAvailable: boolean
  isAutoModeAvailable?: boolean
  strippedDangerousRules?: ToolPermissionRulesBySource
  /*    * When true, permission prompts are auto-denied (e.g., background agents that can't show UI)     */
  shouldAvoidPermissionPrompts?: boolean
  /*    * When true, automated checks (classifier, hooks) are awaited before showing the permission dialog (coordinator workers)     */
  awaitAutomatedChecksBeforeDialog?: boolean
  /*    * Stores the permission mode before model-initiated plan mode entry, so it can be restored on exit     */
  prePlanMode?: PermissionMode
}>

export const getEmptyToolPermissionContext: () => ToolPermissionContext =
  () => ({
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  })

export type CompactProgressEvent =
  | {
      type: 'hooks_start'
      hookType: 'pre_compact' | 'post_compact' | 'session_start'
    }
  | { type: 'compact_start' }
  | { type: 'compact_end' }

export type ToolUseContext = {
  options: {
    commands: Command[]
    debug: boolean
    mainLoopModel: string
    tools: Tools
    verbose: boolean
    thinkingConfig: ThinkingConfig
    mcpClients: MCPServerConnection[]
    mcpResources: Record<string, ServerResource[]>
    isNonInteractiveSession: boolean
    agentDefinitions: AgentDefinitionsResult
    maxBudgetUsd?: number
    /*    * Custom system prompt that replaces the default system prompt     */
    customSystemPrompt?: string
    /*    * Additional system prompt appended after the main system prompt     */
    appendSystemPrompt?: string
    /*    * Override querySource for analytics tracking     */
    querySource?: QuerySource
    /*    * Optional callback to get the latest tools (e.g., after MCP servers connect mid-query)     */
    refreshTools?: () => Tools
  }
  abortController: AbortController
  readFileState: FileStateCache
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  /*    *
   * Always-shared setAppState for session-scoped infrastructure (background
   * tasks, session hooks). Unlike setAppState, which is no-op for async agents
   * (see createSubagentContext), this always reaches the root store so agents
   * at any nesting depth can register/clean up infrastructure that outlives
   * a single turn. Only set by createSubagentContext; main-thread contexts
   * fall back to setAppState.
       */
  setAppStateForTasks?: (f: (prev: AppState) => AppState) => void
  /*    *
   * Optional handler for URL elicitations triggered by tool call errors (-32042).
   * In print/SDK mode, this delegates to structuredIO.handleElicitation.
   * In REPL mode, this is undefined and the queue-based UI path is used.
       */
  handleElicitation?: (
    serverName: string,
    params: ElicitRequestURLParams,
    signal: AbortSignal,
  ) => Promise<ElicitResult>
  setToolJSX?: SetToolJSXFn
  addNotification?: (notif: Notification) => void
  /*    * Append a UI-only system message to the REPL message list. Stripped at the
   *  normalizeMessagesForAPI boundary — the Exclude<> makes that type-enforced.     */
  appendSystemMessage?: (
    msg: Exclude<SystemMessage, SystemLocalCommandMessage>,
  ) => void
  /*    * Send an OS-level notification (iTerm2, Kitty, Ghostty, bell, etc.)     */
  sendOSNotification?: (opts: {
    message: string
    notificationType: string
  }) => void
  nestedMemoryAttachmentTriggers?: Set<string>
  /*    *
   * CLAUDE.md paths already injected as nested_memory attachments this
   * session. Dedup for memoryFilesToAttachments — readFileState is an LRU
   * that evicts entries in busy sessions, so its .has() check alone can
   * re-inject the same CLAUDE.md dozens of times.
       */
  loadedNestedMemoryPaths?: Set<string>
  dynamicSkillDirTriggers?: Set<string>
  /*    * Skill names surfaced via skill_discovery this session. Telemetry only (feeds was_discovered).     */
  discoveredSkillNames?: Set<string>
  userModified?: boolean
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void
  /*    * Only wired in interactive (REPL) contexts; SDK/QueryEngine don't set this.     */
  setHasInterruptibleToolInProgress?: (v: boolean) => void
  setResponseLength: (f: (prev: number) => number) => void
  /*    * Ant-only: push a new API metrics entry for OTPS tracking.
   *  Called by subagent streaming when a new API request starts.     */
  pushApiMetricsEntry?: (ttftMs: number) => void
  setStreamMode?: (mode: SpinnerMode) => void
  onCompactProgress?: (event: CompactProgressEvent) => void
  setSDKStatus?: (status: SDKStatus) => void
  openMessageSelector?: () => void
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void
  updateAttributionState: (
    updater: (prev: AttributionState) => AttributionState,
  ) => void
  setConversationId?: (id: UUID) => void
  agentId?: AgentId // Only set for subagents; use getSessionId() for session ID. Hooks use this to distinguish subagent calls.
  agentType?: string // Subagent type name. For the main thread's --agent type, hooks fall back to getMainThreadAgentType().
  /*    * When true, canUseTool must always be called even when hooks auto-approve.
   *  Used by speculation for overlay file path rewriting.     */
  requireCanUseTool?: boolean
  messages: Message[]
  fileReadingLimits?: {
    maxTokens?: number
    maxSizeBytes?: number
  }
  globLimits?: {
    maxResults?: number
  }
  toolDecisions?: Map<
    string,
    {
      source: string
      decision: 'accept' | 'reject'
      timestamp: number
    }
  >
  queryTracking?: QueryChainTracking
  /*    * Callback factory for requesting interactive prompts from the user.
   * Returns a prompt callback bound to the given source name.
   * Only available in interactive (REPL) contexts.     */
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>
  toolUseId?: string
  criticalSystemReminder_EXPERIMENTAL?: string
  /*    * When true, preserve toolUseResult on messages even for subagents.
   * Used by in-process teammates whose transcripts are viewable by the user.     */
  preserveToolUseResults?: boolean
  /*    * Local denial tracking state for async subagents whose setAppState is a
   *  no-op. Without this, the denial counter never accumulates and the
   *  fallback-to-prompting threshold is never reached. Mutable — the
   *  permissions code updates it in place.     */
  localDenialTracking?: DenialTrackingState
  /*    *
   * Per-conversation-thread content replacement state for the tool result
   * budget. When present, query.ts applies the aggregate tool result budget.
   * Main thread: REPL provisions once (never resets — stale UUID keys
   * are inert). Subagents: createSubagentContext clones the parent's state
   * by default (cache-sharing forks need identical decisions), or
   * resumeAgentBackground threads one reconstructed from sidechain records.
       */
  contentReplacementState?: ContentReplacementState
  /*    *
   * Parent's rendered system prompt bytes, frozen at turn start.
   * Used by fork subagents to share the parent's prompt cache — re-calling
   * getSystemPrompt() at fork-spawn time can diverge (GrowthBook cold→warm)
   * and bust the cache. See forkSubagent.ts.
       */
  renderedSystemPrompt?: SystemPrompt
}

// Re-export ToolProgressData from centralized location
export type { ToolProgressData }

export type Progress = ToolProgressData | HookProgress

export type ToolProgress<P extends ToolProgressData> = {
  toolUseID: string
  data: P
}

export function filterToolProgressMessages(
  progressMessagesForMessage: ProgressMessage[],
): ProgressMessage<ToolProgressData>[] {
  return progressMessagesForMessage.filter(
    (msg): msg is ProgressMessage<ToolProgressData> =>
      msg.data?.type !== 'hook_progress',
  )
}

export type ToolResult<T> = {
  data: T
  newMessages?: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
  )[]
  // contextModifier is only honored for tools that aren't concurrency safe.
  contextModifier?: (context: ToolUseContext) => ToolUseContext
  /*    * MCP protocol metadata (structuredContent, _meta) to pass through to SDK consumers     */
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
}

export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> = (
  progress: ToolProgress<P>,
) => void

// Type for any schema that outputs an object with string keys
export type AnyObject = z.ZodType<{ [key: string]: unknown }>

/*    *
 * 检查工具是否匹配给定的名称（主名称或别名）。
     */
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

/*    *
 * 从工具列表中按名称或别名查找工具。
     */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find(t => toolMatchesName(t, name))
}

export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {


  /*    *
   * 工具重命名时用于向后兼容的可选别名。
   * 除了主名称外，还可以通过这些名称中的任何一个查找工具。
       */
  aliases?: string[]
  /*    *
   * ToolSearch 用于关键字匹配的单行能力短语。
   * 当工具被延迟时，帮助模型通过关键字搜索找到此工具。
   * 3-10 个单词，无尾随句点。
   * 优先使用工具名称中未包含的术语（例如，NotebookEdit 使用 'jupyter'）。
       */
  searchHint?: string
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>,
  ): Promise<ToolResult<Output>>
  description(
    input: z.infer<Input>,
    options: {
      isNonInteractiveSession: boolean
      toolPermissionContext: ToolPermissionContext
      tools: Tools
    },
  ): Promise<string>
  readonly inputSchema: Input
  // 用于可以直接以 JSON Schema 格式指定输入模式的 MCP 工具的类型
  // 而不是从 Zod 模式转换
  readonly inputJSONSchema?: ToolInputJSONSchema
  // 可选，因为 TungstenTool 没有定义这个。TODO：使其成为必需。
  // 当我们这样做时，我们还可以使这更类型安全。
  outputSchema?: z.ZodType<unknown>
  inputsEquivalent?(a: z.infer<Input>, b: z.infer<Input>): boolean
  isConcurrencySafe(input: z.infer<Input>): boolean
  isEnabled(): boolean
  isReadOnly(input: z.infer<Input>): boolean
  /*    * Defaults to false. Only set when the tool performs irreversible operations (delete, overwrite, send).     */
  isDestructive?(input: z.infer<Input>): boolean
  /*    *
   * What should happen when the user submits a new message while this tool
   * is running.
   *
   * - `'cancel'` — stop the tool and discard its result
   * - `'block'`  — keep running; the new message waits
   *
   * Defaults to `'block'` when not implemented.
       */
  interruptBehavior?(): 'cancel' | 'block'
  /*    *
   * Returns information about whether this tool use is a search or read operation
   * that should be collapsed into a condensed display in the UI. Examples include
   * file searching (Grep, Glob), file reading (Read), and bash commands like find,
   * grep, wc, etc.
   *
   * Returns an object indicating whether the operation is a search or read operation:
   * - `isSearch: true` for search operations (grep, find, glob patterns)
   * - `isRead: true` for read operations (cat, head, tail, file read)
   * - `isList: true` for directory-listing operations (ls, tree, du)
   * - All can be false if the operation shouldn't be collapsed
       */
  isSearchOrReadCommand?(input: z.infer<Input>): {
    isSearch: boolean
    isRead: boolean
    isList?: boolean
  }
  isOpenWorld?(input: z.infer<Input>): boolean
  requiresUserInteraction?(): boolean
  isMcp?: boolean
  isLsp?: boolean
  /*    *
   * When true, this tool is deferred (sent with defer_loading: true) and requires
   * ToolSearch to be used before it can be called.
       */
  readonly shouldDefer?: boolean
  /*    *
   * When true, this tool is never deferred — its full schema appears in the
   * initial prompt even when ToolSearch is enabled. For MCP tools, set via
   * `_meta['anthropic/alwaysLoad']`. Use for tools the model must see on
   * turn 1 without a ToolSearch round-trip.
       */
  readonly alwaysLoad?: boolean
  /*    *
   * 对于 MCP 工具：从 MCP 服务器接收的服务器和工具名称（未规范化）。
   * 存在于所有 MCP 工具上，无论 `name` 是否带有前缀（mcp__server__tool）
   * 或不带前缀（CLAUDE_AGENT_SDK_MCP_NO_PREFIX 模式）。
       */
  mcpInfo?: { serverName: string; toolName: string }
  readonly name: string
  /*    *
   * 工具结果在持久化到磁盘之前的最大字符大小。
   * 超过时，结果会保存到文件中，Claude 会收到带有文件路径的预览
   * 而不是完整内容。
   *
   * 对于输出绝不能被持久化的工具（例如 Read，
   * 其中持久化会创建循环的 Read→file→Read 循环，并且工具
   * 已经通过自己的限制自绑定），设置为 Infinity。
       */
  maxResultSizeChars: number
  /*    *
   * 当为 true 时，为此工具启用严格模式，这会使 API
   * 更严格地遵守工具指令和参数模式。
   * 仅在 tengu_tool_pear 启用时应用。
       */
  readonly strict?: boolean

  /*    *
   * 在观察者看到工具使用输入的副本之前调用（SDK 流、
   *  transcript、canUseTool、PreToolUse/PostToolUse 钩子）。就地修改
   * 以添加遗留/派生字段。必须是幂等的。原始的 API 绑定
   * 输入永远不会被修改（保留提示缓存）。当
   * 钩子/权限返回新的 updatedInput 时不会重新应用 - 它们拥有自己的形状。
       */
  backfillObservableInput?(input: Record<string, unknown>): void

  /*    *
   * 确定此工具是否允许在当前上下文中使用此输入运行。
   * 它会告知模型工具使用失败的原因，并且不会直接显示任何 UI。
   * @param input
   * @param context
       */
  validateInput?(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<ValidationResult>

  /*    *
   * 确定是否向用户请求权限。仅在 validateInput() 通过后调用。
   * 通用权限逻辑在 permissions.ts 中。此方法包含工具特定的逻辑。
   * @param input
   * @param context
       */
  checkPermissions(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<PermissionResult>

  // Optional method for tools that operate on a file path
  getPath?(input: z.infer<Input>): string

  /*    *
   * 为钩子 `if` 条件准备匹配器（权限规则模式，如
   * "Bash(git *)" 中的 "git *"）。每个钩子-输入对调用一次；任何
   * 昂贵的解析都在这里发生。返回一个每个钩子模式调用的闭包。
   * 如果未实现，只有工具名称级别的匹配有效。
       */
  preparePermissionMatcher?(
    input: z.infer<Input>,
  ): Promise<(pattern: string) => boolean>

  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
  }): Promise<string>
  userFacingName(input: Partial<z.infer<Input>> | undefined): string
  userFacingNameBackgroundColor?(
    input: Partial<z.infer<Input>> | undefined,
  ): keyof Theme | undefined
  /*    *
   * 透明包装器（例如 REPL）将所有渲染委托给它们的进度
   * 处理程序，该处理程序为每个内部工具调用发出看起来原生的块。
   * 包装器本身不显示任何内容。
       */
  isTransparentWrapper?(): boolean
  /*    *
   * 返回此工具使用的简短字符串摘要，用于在紧凑视图中显示。
   * @param input 工具输入
   * @returns 简短字符串摘要，或 null 表示不显示
       */
  getToolUseSummary?(input: Partial<z.infer<Input>> | undefined): string | null
  /*    *
   * 返回用于 spinner 显示的人类可读的现在时活动描述。
   * 示例："Reading src/foo.ts"、"Running bun test"、"Searching for pattern"
   * @param input 工具输入
   * @returns 活动描述字符串，或 null 表示回退到工具名称
       */
  getActivityDescription?(
    input: Partial<z.infer<Input>> | undefined,
  ): string | null
  /*    *
   * 返回此工具使用的紧凑表示，用于自动模式
   * 安全分类器。示例：Bash 的 `ls -la`，Edit 的 `/tmp/x: new content`
   * 。返回 '' 以在分类器记录中跳过此工具
   *（例如，与安全无关的工具）。可以返回对象以避免
   * 当调用者 JSON 包装值时的双重编码。
       */
  toAutoClassifierInput(input: z.infer<Input>): unknown
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam
  /*    *
   * 可选。省略时，工具结果不渲染任何内容（与返回
   * null 相同）。对于结果在其他地方显示的工具（例如，TodoWrite
   * 更新 todo 面板，而不是记录），请省略。
       */
  renderToolResultMessage?(
    content: Output,
    progressMessagesForMessage: ProgressMessage<P>[],
    options: {
      style?: 'condensed'
      theme: ThemeName
      tools: Tools
      verbose: boolean
      isTranscriptMode?: boolean
      isBriefOnly?: boolean
      /*    * 原始 tool_use 输入（当可用时）。对于引用请求内容的紧凑结果
       * 摘要很有用（例如 "Sent to #foo"）。     */
      input?: unknown
    },
  ): React.ReactNode
  /*    *
   * renderToolResultMessage 在记录模式（verbose=true, isTranscriptMode=true）下显示的扁平化文本。
   * 对于记录搜索索引：索引计算此字符串中的出现次数，高亮
   * 覆盖扫描实际屏幕缓冲区。对于 count ≡ highlight，这
   * 必须返回最终可见的文本 — 而不是 mapToolResultToToolResultBlockParam
   * 的面向模型的序列化（它添加了系统提醒、持久化输出包装器）。
   *
   * 可以跳过 Chrome（计数不足是可以的）。"Found 3 files in 12ms"
   * 不值得索引。幻影是不行的 — 这里声称但不渲染的文本是 count≠highlight 错误。
   *
   * 可选：省略 → transcriptSearch.ts 中的字段名称启发式。
   * 漂移由 test/utils/transcriptSearch.renderFidelity.test.tsx 捕获
   * 它渲染样本输出并标记索引但未渲染（幻影）或渲染但未索引（计数不足警告）的文本。
       */
  extractSearchText?(out: Output): string
  /*    *
   * 渲染工具使用消息。注意 `input` 是部分的，因为我们尽快渲染
   * 消息，可能在工具参数完全流式传输之前。
       */
  renderToolUseMessage(
    input: Partial<z.infer<Input>>,
    options: { theme: ThemeName; verbose: boolean; commands?: Command[] },
  ): React.ReactNode
  /*    *
   * 当此输出的非详细渲染被截断时返回 true
   *（即，点击展开会显示更多内容）。控制
   * 全屏中的点击展开 — 只有详细模式实际
   * 显示更多内容的消息才会获得悬停/点击提示。未设置表示永远不会截断。
       */
  isResultTruncated?(output: Output): boolean
  /*    *
   * 渲染一个可选的标签，显示在工具使用消息之后。
   * 用于附加元数据，如超时、模型、恢复 ID 等。
   * 返回 null 表示不显示任何内容。
       */
  renderToolUseTag?(input: Partial<z.infer<Input>>): React.ReactNode
  /*    *
   * 可选。省略时，工具运行时不显示进度 UI。
       */
  renderToolUseProgressMessage?(
    progressMessagesForMessage: ProgressMessage<P>[],
    options: {
      tools: Tools
      verbose: boolean
      terminalSize?: { columns: number; rows: number }
      inProgressToolCallCount?: number
      isTranscriptMode?: boolean
    },
  ): React.ReactNode
  renderToolUseQueuedMessage?(): React.ReactNode
  /*    *
   * 可选。省略时，回退到 <FallbackToolUseRejectedMessage />。
   * 只为需要自定义拒绝 UI 的工具定义此方法（例如，显示拒绝的差异的文件编辑）。
       */
  renderToolUseRejectedMessage?(
    input: z.infer<Input>,
    options: {
      columns: number
      messages: Message[]
      style?: 'condensed'
      theme: ThemeName
      tools: Tools
      verbose: boolean
      progressMessagesForMessage: ProgressMessage<P>[]
      isTranscriptMode?: boolean
    },
  ): React.ReactNode
  /*    *
   * Optional. When omitted, falls back to <FallbackToolUseErrorMessage />.
   * Only define this for tools that need custom error UI (e.g., search tools
   * that show "File not found" instead of the raw error).
       */
  renderToolUseErrorMessage?(
    result: ToolResultBlockParam['content'],
    options: {
      progressMessagesForMessage: ProgressMessage<P>[]
      tools: Tools
      verbose: boolean
      isTranscriptMode?: boolean
    },
  ): React.ReactNode

  /*    *
   * Renders multiple parallel instances of this tool as a group.
   * @returns React node to render, or null to fall back to individual rendering
       */
  /*    *
   * Renders multiple tool uses as a group (non-verbose mode only).
   * In verbose mode, individual tool uses render at their original positions.
   * @returns React node to render, or null to fall back to individual rendering
       */
  renderGroupedToolUse?(
    toolUses: Array<{
      param: ToolUseBlockParam
      isResolved: boolean
      isError: boolean
      isInProgress: boolean
      progressMessages: ProgressMessage<P>[]
      result?: {
        param: ToolResultBlockParam
        output: unknown
      }
    }>,
    options: {
      shouldAnimate: boolean
      tools: Tools
    },
  ): React.ReactNode | null
}

/*    *
 * A collection of tools. Use this type instead of `Tool[]` to make it easier
 * to track where tool sets are assembled, passed, and filtered across the codebase.
     */
export type Tools = readonly Tool[]

/*    *
 * Methods that `buildTool` supplies a default for. A `ToolDef` may omit these;
 * the resulting `Tool` always has them.
     */
type DefaultableToolKeys =
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'toAutoClassifierInput'
  | 'userFacingName'

/*    *
 * Tool definition accepted by `buildTool`. Same shape as `Tool` but with the
 * defaultable methods optional — `buildTool` fills them in so callers always
 * see a complete `Tool`.
     */
export type ToolDef<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = Omit<Tool<Input, Output, P>, DefaultableToolKeys> &
  Partial<Pick<Tool<Input, Output, P>, DefaultableToolKeys>>

/*    *
 * Type-level spread mirroring `{ ...TOOL_DEFAULTS, ...def }`. For each
 * defaultable key: if D provides it (required), D's type wins; if D omits
 * it or has it optional (inherited from Partial<> in the constraint), the
 * default fills in. All other keys come from D verbatim — preserving arity,
 * optional presence, and literal types exactly as `satisfies Tool` did.
     */
type BuiltTool<D> = Omit<D, DefaultableToolKeys> & {
  [K in DefaultableToolKeys]-?: K extends keyof D
    ? undefined extends D[K]
      ? ToolDefaults[K]
      : D[K]
    : ToolDefaults[K]
}

/*    *
 * Build a complete `Tool` from a partial definition, filling in safe defaults
 * for the commonly-stubbed methods. All tool exports should go through this so
 * that defaults live in one place and callers never need `?.() ?? default`.
 *
 * 默认值（在重要的地方失败关闭）：
 * - `isEnabled` → `true`
 * - `isConcurrencySafe` → `false` (assume not safe)
 * - `isReadOnly` → `false` (assume writes)
 * - `isDestructive` → `false`
 * - `checkPermissions` → `{ behavior: 'allow', updatedInput }` (defer to general permission system)
 * - `toAutoClassifierInput` → `''` (skip classifier — security-relevant tools must override)
 * - `userFacingName` → `name`
     */
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?: unknown) => false,
  isReadOnly: (_input?: unknown) => false,
  isDestructive: (_input?: unknown) => false,
  checkPermissions: (
    input: { [key: string]: unknown },
    _ctx?: ToolUseContext,
  ): Promise<PermissionResult> =>
    Promise.resolve({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: (_input?: unknown) => '',
  userFacingName: (_input?: unknown) => '',
}

// The defaults type is the ACTUAL shape of TOOL_DEFAULTS (optional params so
// both 0-arg and full-arg call sites type-check — stubs varied in arity and
// tests relied on that), not the interface's strict signatures.
type ToolDefaults = typeof TOOL_DEFAULTS

// D infers the concrete object-literal type from the call site. The
// constraint provides contextual typing for method parameters; `any` in
// constraint position is structural and never leaks into the return type.
// BuiltTool<D> mirrors runtime `{...TOOL_DEFAULTS, ...def}` at the type level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = ToolDef<any, any, any>

export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  // The runtime spread is straightforward; the `as` bridges the gap between
  // the structural-any constraint and the precise BuiltTool<D> return. The
  // type semantics are proven by the 0-error typecheck across all 60+ tools.
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>
}
