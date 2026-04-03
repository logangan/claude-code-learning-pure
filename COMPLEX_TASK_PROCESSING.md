# Claude Code 复杂任务处理机制详解

本文档深入分析 Claude Code 如何处理复杂任务，包括任务拆解、状态更新、执行流程、通信机制、前端交互、反思机制以及执行效果保证。

---

## 一、复杂任务拆解机制

### 1.1 任务拆解架构

Claude Code 使用多层次的架构来处理复杂任务：

```
用户输入
    ↓
REPL.tsx (前端界面)
    ↓
processUserInput (输入处理)
    ↓
QueryEngine (查询引擎)
    ↓
query.ts (查询循环)
    ↓
工具执行 → 子任务创建
    ↓
结果汇总 → 返回用户
```

### 1.2 任务拆解策略

#### 1.2.1 TodoWriteTool 任务拆解

```typescript
// TodoWriteTool 实现任务拆解
export const TodoWriteTool = buildTool(
  TODO_WRITE_TOOL_NAME,
  'Manages a todo list for tracking tasks and progress',
  {
    inputSchema: z.object({
      todos: z.array(z.object({
        id: z.string(),
        content: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
        priority: z.enum(['high', 'medium', 'low']).optional(),
      })),
    }),
    
    async *call(input, context, toolUseID, assistantMessage) {
      const { todos } = input
      
      // 更新任务列表状态
      context.setAppState(prev => ({
        ...prev,
        tasks: {
          ...prev.tasks,
          todoList: todos,
        }
      }))
      
      yield {
        type: 'result',
        result: {
          content: `Updated ${todos.length} tasks`,
        },
      }
    },
  },
)
```

#### 1.2.2 AgentTool 子代理拆解

```typescript
// AgentTool 将复杂任务拆解给子代理
async function* spawnBackgroundAgent(
  input: AgentToolInput,
  context: ToolUseContext,
  toolUseID: string,
): AsyncGenerator<ToolYield, void, unknown> {
  const { description, prompt, subagent_type } = input
  
  // 1. 创建任务输出
  const taskOutput = new TaskOutput()
  
  // 2. 创建代理任务
  const agentTask: LocalAgentTaskState = {
    id: generateUUID(),
    type: 'local_agent',
    status: 'running',
    description,
    prompt,
    subagentType: subagent_type,
    toolUseID,
    outputFile: taskOutput.path,
    startTime: Date.now(),
  }
  
  // 3. 注册任务
  registerTask(agentTask, context.setAppState)
  
  // 4. 创建 QueryEngine 执行子任务
  const queryEngine = new QueryEngine({
    cwd: context.cwd,
    agentType: subagent_type,
  })
  
  // 5. 异步执行子任务
  void (async () => {
    const messageStream = queryEngine.submitMessage(prompt)
    
    for await (const message of messageStream) {
      await taskOutput.write(message)
    }
    
    // 完成任务
    completeTask(agentTask.id, context.setAppState)
  })()
  
  yield {
    type: 'result',
    result: {
      content: `Background agent started: ${agentTask.id}`,
      taskId: agentTask.id,
    },
  }
}
```

#### 1.2.3 任务依赖管理

```typescript
// 任务依赖关系
export type Task = {
  id: string
  subject: string
  description: string
  status: TaskStatus
  blocks: string[]        // 阻塞的任务 ID
  blockedBy: string[]     // 被哪些任务阻塞
  metadata?: Record<string, unknown>
}

// 检查任务是否可以执行
export function canExecuteTask(
  task: Task,
  allTasks: Map<string, Task>,
): boolean {
  // 检查所有依赖是否已完成
  for (const blockerId of task.blockedBy) {
    const blocker = allTasks.get(blockerId)
    if (!blocker || blocker.status !== 'completed') {
      return false
    }
  }
  return true
}
```

---

## 二、任务状态更新机制

### 2.1 状态管理架构

```typescript
// AppState 中的任务状态
export type AppState = {
  tasks: {
    [taskId: string]: TaskState
  }
  todoList?: TodoItem[]
}

// 任务状态更新函数
export function updateTaskState<T extends TaskState>(
  taskId: string,
  setAppState: SetAppState,
  updater: (task: T) => T,
): void {
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!task) return prev
    
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: updater(task as T),
      }
    }
  })
}
```

### 2.2 状态更新流程

```
任务状态变更
    ↓
调用 updateTaskState
    ↓
更新 AppState
    ↓
触发订阅者通知
    ↓
UI 重新渲染
```

### 2.3 状态订阅机制

```typescript
// 任务更新信号
const tasksUpdated = createSignal()

// 订阅任务更新
export const onTasksUpdated = tasksUpdated.subscribe

// 通知任务更新
export function notifyTasksUpdated(): void {
  try {
    tasksUpdated.emit()
  } catch {
    // 忽略监听器错误
  }
}

// 在组件中使用
function TaskListComponent() {
  useEffect(() => {
    const unsubscribe = onTasksUpdated(() => {
      // 重新加载任务列表
      loadTasks()
    })
    return unsubscribe
  }, [])
}
```

---

## 三、任务执行流程

### 3.1 执行流程架构

```typescript
// QueryEngine 提交消息
async function* submitMessage(
  prompt: string | ContentBlockParam[],
  options?: { uuid?: string; isMeta?: boolean },
): AsyncGenerator<SDKMessage, void, unknown> {
  
  // 1. 处理用户输入
  const processResult = await processUserInput({
    input: prompt,
    mode: 'prompt',
    context: processUserInputContext,
  })
  
  // 2. 更新消息历史
  this.mutableMessages.push(...processResult.messages)
  
  // 3. 执行查询循环
  const queryResult = yield* query({
    messages: this.mutableMessages,
    systemPrompt,
    toolUseContext,
    canUseTool: wrappedCanUseTool,
  })
  
  // 4. 处理结果
  // ...
}
```

### 3.2 查询循环详解

```typescript
// query.ts - 核心查询循环
export async function* query(
  params: QueryParams,
): AsyncGenerator<StreamEvent | Message, Terminal> {
  
  // 初始化状态
  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    turnCount: 1,
    // ...
  }
  
  // 主循环
  while (true) {
    // 1. 检查终止条件
    if (state.turnCount > (params.maxTurns ?? Infinity)) {
      return { type: 'terminal', reason: 'max_turns_reached' }
    }
    
    // 2. 调用 API
    const apiStream = yield* callAPI({
      messages: state.messages,
      systemPrompt: params.systemPrompt,
      tools: state.toolUseContext.tools,
    })
    
    // 3. 处理流式响应
    for await (const event of apiStream) {
      yield event
      
      // 处理工具调用
      if (event.type === 'tool_use') {
        const toolResult = yield* executeTool(event, state.toolUseContext)
        state.messages.push(toolResult)
      }
    }
    
    // 4. 检查是否继续
    const shouldContinue = checkShouldContinue(state.messages)
    if (!shouldContinue) {
      return { type: 'terminal', reason: 'complete' }
    }
    
    // 5. 更新状态继续下一轮
    state = {
      ...state,
      turnCount: state.turnCount + 1,
    }
  }
}
```

### 3.3 工具执行流程

```typescript
// StreamingToolExecutor 执行工具
export class StreamingToolExecutor {
  async *execute(
    toolUse: ToolUseBlock,
    context: ToolUseContext,
  ): AsyncGenerator<ToolYield, ToolResult, unknown> {
    
    // 1. 查找工具
    const tool = findToolByName(toolUse.name, context.tools)
    if (!tool) {
      return {
        type: 'tool_result',
        content: `Tool not found: ${toolUse.name}`,
        is_error: true,
        tool_use_id: toolUse.id,
      }
    }
    
    // 2. 检查权限
    const permissionResult = await context.canUseTool(
      tool,
      toolUse.input,
      context,
      toolUse.id,
    )
    
    if (permissionResult.behavior !== 'allow') {
      return {
        type: 'tool_result',
        content: 'Permission denied',
        is_error: true,
        tool_use_id: toolUse.id,
      }
    }
    
    // 3. 执行工具
    const toolCall = tool.call(
      toolUse.input,
      context,
      toolUse.id,
      assistantMessage,
    )
    
    // 4. 产出中间结果
    for await (const yield_ of toolCall) {
      yield yield_
    }
    
    // 5. 返回最终结果
    return {
      type: 'tool_result',
      content: result,
      tool_use_id: toolUse.id,
    }
  }
}
```

---

## 四、任务通信机制

### 4.1 进程间通信

```typescript
// 使用文件系统作为 IPC 机制
export async function sendMessageToTask(
  taskId: string,
  message: TaskMessage,
): Promise<void> {
  const inboxPath = getTaskInboxPath(taskId)
  await appendFile(inboxPath, JSON.stringify(message) + '\n')
}

// 监听消息
export function watchTaskInbox(
  taskId: string,
  callback: (message: TaskMessage) => void,
): () => void {
  const inboxPath = getTaskInboxPath(taskId)
  const watcher = watch(inboxPath, (eventType, filename) => {
    if (eventType === 'change') {
      readNewMessages(inboxPath).then(messages => {
        messages.forEach(callback)
      })
    }
  })
  
  return () => watcher.close()
}
```

### 4.2 代理间通信

```typescript
// 队友间通信
export async function sendMessageToTeammate(
  teamName: string,
  agentId: string,
  message: TeammateMessage,
): Promise<void> {
  const mailboxPath = getTeamMailboxPath(teamName)
  const messageFile = path.join(mailboxPath, `${Date.now()}-${agentId}.json`)
  
  await writeFile(messageFile, JSON.stringify(message))
}

// 轮询队友消息
export function useTeammateMessagePoller(
  teamName: string,
  agentId: string,
) {
  useEffect(() => {
    const interval = setInterval(async () => {
      const messages = await pollTeammateMessages(teamName, agentId)
      messages.forEach(handleMessage)
    }, 1000)
    
    return () => clearInterval(interval)
  }, [teamName, agentId])
}
```

### 4.3 状态同步

```typescript
// 任务状态同步
export async function syncTaskState(
  taskId: string,
  state: TaskState,
): Promise<void> {
  const statePath = getTaskStatePath(taskId)
  await writeFile(statePath, JSON.stringify(state))
}

// 读取任务状态
export async function readTaskState(
  taskId: string,
): Promise<TaskState | undefined> {
  try {
    const statePath = getTaskStatePath(taskId)
    const content = await readFile(statePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return undefined
  }
}
```

---

## 五、前端交互机制

### 5.1 REPL 组件架构

```typescript
// REPL.tsx - 主界面组件
export function REPL() {
  // 状态管理
  const appState = useAppState()
  const setAppState = useSetAppState()
  
  // 消息处理
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  
  // 提示提交处理
  const handlePromptSubmit = async (input: string) => {
    setIsProcessing(true)
    
    // 创建 QueryEngine
    const queryEngine = new QueryEngine({
      cwd: appState.cwd,
      tools: mergedTools,
      commands: mergedCommands,
      getAppState: () => appState,
      setAppState,
    })
    
    // 提交消息
    const messageStream = queryEngine.submitMessage(input)
    
    // 处理流式响应
    for await (const message of messageStream) {
      setMessages(prev => [...prev, message])
    }
    
    setIsProcessing(false)
  }
  
  return (
    <Box flexDirection="column">
      <Messages messages={messages} />
      <PromptInput 
        onSubmit={handlePromptSubmit}
        isProcessing={isProcessing}
      />
    </Box>
  )
}
```

### 5.2 消息渲染

```typescript
// Messages.tsx - 消息列表组件
export function Messages({ messages }: { messages: Message[] }) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <MessageItem 
          key={message.uuid || index}
          message={message}
        />
      ))}
    </Box>
  )
}

// 单个消息项
function MessageItem({ message }: { message: Message }) {
  switch (message.type) {
    case 'user':
      return <UserMessage message={message} />
    case 'assistant':
      return <AssistantMessage message={message} />
    case 'tool_result':
      return <ToolResultMessage message={message} />
    case 'progress':
      return <ProgressMessage message={message} />
    default:
      return null
  }
}
```

### 5.3 进度显示

```typescript
// 进度消息组件
export function ProgressMessage({ message }: { message: ProgressMessage }) {
  return (
    <Box>
      <Spinner />
      <Text>{message.content}</Text>
    </Box>
  )
}

// 工具使用进度
export function ToolUseProgress({ toolUse }: { toolUse: StreamingToolUse }) {
  return (
    <Box flexDirection="column">
      <Text>Using {toolUse.name}...</Text>
      {toolUse.yields.map((yield_, index) => (
        <Text key={index} dimColor>
          {yield_.type === 'progress' ? yield_.message : ''}
        </Text>
      ))}
    </Box>
  )
}
```

---

## 六、任务反思机制

### 6.1 反思触发条件

```typescript
// 检查是否需要反思
export function shouldReflect(
  messages: Message[],
  context: ToolUseContext,
): boolean {
  // 1. 检查是否有工具调用失败
  const hasFailedTools = messages.some(
    m => m.type === 'tool_result' && m.is_error
  )
  
  // 2. 检查是否达到反思阈值
  const toolCallCount = countToolCalls(messages)
  if (toolCallCount > REFLECTION_THRESHOLD) {
    return true
  }
  
  // 3. 检查用户是否明确要求反思
  const lastUserMessage = getLastUserMessage(messages)
  if (lastUserMessage?.content.includes('reflect')) {
    return true
  }
  
  return hasFailedTools
}
```

### 6.2 反思执行

```typescript
// 执行反思
async function* executeReflection(
  messages: Message[],
  context: ToolUseContext,
): AsyncGenerator<ReflectionYield, ReflectionResult, unknown> {
  
  // 1. 分析当前状态
  const analysis = analyzeConversation(messages)
  
  yield {
    type: 'reflection_progress',
    message: 'Analyzing conversation history...',
  }
  
  // 2. 识别问题
  const issues = identifyIssues(analysis)
  
  yield {
    type: 'reflection_progress',
    message: `Found ${issues.length} issues`,
  }
  
  // 3. 生成改进建议
  const suggestions = generateSuggestions(issues)
  
  yield {
    type: 'reflection_progress',
    message: 'Generating improvement suggestions...',
  }
  
  // 4. 返回反思结果
  return {
    type: 'reflection_result',
    analysis,
    issues,
    suggestions,
  }
}
```

### 6.3 反思提示词

```typescript
const REFLECTION_PROMPT = `Please reflect on the previous actions and results.

Consider:
1. Were the tools used effectively?
2. Were there any errors or unexpected results?
3. Could the approach be improved?
4. What have we learned from this interaction?

Provide a brief summary of what worked well and what could be improved.`
```

---

## 七、执行效果保证机制

### 7.1 权限控制

```typescript
// 权限检查
export async function canUseTool(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<PermissionResult> {
  
  // 1. 检查全局权限模式
  const mode = context.permissionMode
  
  if (mode === 'bypassPermissions') {
    return { behavior: 'allow' }
  }
  
  // 2. 检查权限规则
  const rules = context.permissionRules
  
  for (const rule of rules.alwaysAllow) {
    if (matchesRule(tool, input, rule)) {
      return { behavior: 'allow', rule }
    }
  }
  
  for (const rule of rules.alwaysDeny) {
    if (matchesRule(tool, input, rule)) {
      return { behavior: 'deny', rule }
    }
  }
  
  // 3. AI 分类器（自动模式）
  if (mode === 'auto') {
    const classification = await classifyToolUse(tool, input)
    if (classification.confidence > 0.8) {
      return {
        behavior: classification.isSafe ? 'allow' : 'ask',
        classifier: classification,
      }
    }
  }
  
  // 4. 默认行为
  if (tool.isReadOnly) {
    return { behavior: 'allow' }
  }
  
  return { behavior: 'ask' }
}
```

### 7.2 错误处理

```typescript
// 错误处理策略
export async function handleToolError(
  error: Error,
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<ToolResult> {
  
  // 1. 记录错误
  logError(`Tool ${tool.name} failed:`, error)
  
  // 2. 分类错误
  const errorType = classifyError(error)
  
  switch (errorType) {
    case 'retryable':
      // 重试
      return await retryToolCall(tool, input, context)
      
    case 'permission_denied':
      // 请求权限
      return {
        type: 'tool_result',
        content: 'Permission denied. Please grant permission and try again.',
        is_error: true,
        tool_use_id: input.tool_use_id,
      }
      
    case 'not_found':
      // 查找替代方案
      return await findAlternative(tool, input, context)
      
    default:
      // 返回错误
      return {
        type: 'tool_result',
        content: `Error: ${error.message}`,
        is_error: true,
        tool_use_id: input.tool_use_id,
      }
  }
}
```

### 7.3 验证机制

```typescript
// 结果验证
export async function verifyToolResult(
  tool: Tool,
  input: Record<string, unknown>,
  result: ToolResult,
  context: ToolUseContext,
): Promise<boolean> {
  
  // 1. 检查结果格式
  if (!isValidResultFormat(result)) {
    return false
  }
  
  // 2. 验证结果内容
  switch (tool.name) {
    case 'FileReadTool':
      return await verifyFileReadResult(result, input, context)
      
    case 'BashTool':
      return verifyBashResult(result, input)
      
    case 'FileEditTool':
      return await verifyFileEditResult(result, input, context)
      
    default:
      return true
  }
}

// 文件读取验证
async function verifyFileReadResult(
  result: ToolResult,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<boolean> {
  const filePath = input.file_path as string
  
  // 检查文件是否存在
  const exists = await checkFileExists(filePath)
  if (!exists) {
    return false
  }
  
  // 检查读取的内容是否匹配
  const actualContent = await readFile(filePath, 'utf-8')
  const resultContent = result.content as string
  
  return actualContent === resultContent
}
```

### 7.4 重试机制

```typescript
// 带重试的工具调用
export async function callToolWithRetry(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
  maxRetries: number = 3,
): Promise<ToolResult> {
  let lastError: Error | undefined
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await tool.call(input, context)
      
      // 验证结果
      if (await verifyToolResult(tool, input, result, context)) {
        return result
      }
      
      throw new Error('Result verification failed')
      
    } catch (error) {
      lastError = error as Error
      
      // 计算退避时间
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      await sleep(backoffMs)
    }
  }
  
  throw lastError || new Error('Max retries exceeded')
}
```

### 7.5 会话恢复

```typescript
// 会话状态保存
export async function saveSessionState(
  sessionId: string,
  state: SessionState,
): Promise<void> {
  const statePath = getSessionStatePath(sessionId)
  await writeFile(statePath, JSON.stringify(state, null, 2))
}

// 会话恢复
export async function restoreSession(
  sessionId: string,
): Promise<SessionState | undefined> {
  try {
    const statePath = getSessionStatePath(sessionId)
    const content = await readFile(statePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

// 自动保存
export function useAutoSave(
  sessionId: string,
  state: SessionState,
  intervalMs: number = 30000,
) {
  useEffect(() => {
    const interval = setInterval(() => {
      saveSessionState(sessionId, state)
    }, intervalMs)
    
    return () => clearInterval(interval)
  }, [sessionId, state, intervalMs])
}
```

---

## 八、总结

Claude Code 的复杂任务处理机制具有以下特点：

1. **分层架构**: 从前端到后端，从输入处理到工具执行，层次分明
2. **异步流式**: 使用 AsyncGenerator 实现流式处理和实时反馈
3. **状态管理**: 集中式状态管理，支持订阅和自动同步
4.