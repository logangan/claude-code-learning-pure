# Claude Code Task 生命周期详解

本文档详细分析 Claude Code 中 Task 系统的设计逻辑、架构和生命周期管理。

## 一、Task 系统概述

### 1.1 Task 类型定义

**文件**: `src/tasks/types.ts`

```typescript
// Union of all concrete task state types
export type TaskState =
  | LocalShellTaskState      // 本地 Shell 任务
  | LocalAgentTaskState      // 本地代理任务
  | RemoteAgentTaskState     // 远程代理任务
  | InProcessTeammateTaskState  // 进程内队友任务
  | LocalWorkflowTaskState   // 本地工作流任务
  | MonitorMcpTaskState      // MCP 监控任务
  | DreamTaskState           // Dream 任务

// Task types that can appear in the background tasks indicator
export type BackgroundTaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | DreamTaskState

// 判断是否为后台任务
export function isBackgroundTask(task: TaskState): task is BackgroundTaskState {
  if (task.status !== 'running' && task.status !== 'pending') {
    return false
  }
  // Foreground tasks (isBackgrounded === false) are not yet "background tasks"
  if ('isBackgrounded' in task && task.isBackgrounded === false) {
    return false
  }
  return true
}
```

### 1.2 Task 基础接口

**文件**: `src/Task.ts`

```typescript
export type TaskStateBase = {
  id: string                    // 任务唯一标识
  type: TaskType               // 任务类型
  status: TaskStatus           // 任务状态
  description: string          // 任务描述
  toolUseID?: string           // 关联的工具调用 ID
  startTime?: number           // 开始时间
  endTime?: number             // 结束时间
  notified?: boolean           // 是否已通知
}

export type TaskStatus = 
  | 'pending'      // 待执行
  | 'running'      // 运行中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'killed'       // 被终止

export type TaskType =
  | 'local_bash'       // 本地 Bash
  | 'local_agent'      // 本地代理
  | 'remote_agent'     // 远程代理
  | 'in_process_teammate'  // 进程内队友
  | 'local_workflow'   // 本地工作流
  | 'monitor_mcp'      // MCP 监控
  | 'dream'            // Dream
```

---

## 二、Task 类型详解

### 2.1 LocalShellTask（本地 Shell 任务）

**文件**: `src/tasks/LocalShellTask/guards.ts`

```typescript
export type BashTaskKind = 'bash' | 'monitor'

export type LocalShellTaskState = TaskStateBase & {
  type: 'local_bash'
  command: string              // 执行的命令
  result?: {
    code: number              // 退出码
    interrupted: boolean      // 是否被中断
  }
  completionStatusSentInAttachment: boolean
  shellCommand: ShellCommand | null  // Shell 命令实例
  unregisterCleanup?: () => void     // 清理函数
  cleanupTimeoutId?: NodeJS.Timeout
  lastReportedTotalLines: number     // 最后报告的行数
  isBackgrounded: boolean            // 是否已后台化
  agentId?: AgentId                  // 创建该任务的代理 ID
  kind?: BashTaskKind                // 任务类型（bash/monitor）
}
```

**文件**: `src/tasks/LocalShellTask/LocalShellTask.tsx`

```typescript
export const LocalShellTask: Task = {
  name: 'LocalShellTask',
  type: 'local_bash',
  async kill(taskId, setAppState) {
    killTask(taskId, setAppState)
  }
}

// 创建并启动 Shell 任务
export async function spawnShellTask(
  input: LocalShellSpawnInput & {
    shellCommand: ShellCommand
  },
  context: TaskContext,
): Promise<TaskHandle> {
  const { command, description, shellCommand, toolUseId, agentId, kind } = input
  const { setAppState } = context

  // 使用 TaskOutput 的 taskId 保持一致性
  const { taskOutput } = shellCommand
  const taskId = taskOutput.taskId
  
  // 注册清理函数
  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState)
  })
  
  // 创建任务状态
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
    agentId,
    kind
  }
  
  // 注册任务
  registerTask(taskState, setAppState)

  // 后台化进程
  shellCommand.background(taskId)
  
  // 启动停滞检测
  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId)
  
  // 等待任务完成
  void shellCommand.result.then(async result => {
    cancelStallWatchdog()
    await flushAndCleanup(shellCommand)
    
    let wasKilled = false
    updateTaskState<LocalShellTaskState>(taskId, setAppState, task => {
      if (task.status === 'killed') {
        wasKilled = true
        return task
      }
      return {
        ...task,
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      }
    })
    
    // 发送完成通知
    enqueueShellNotification(
      taskId, 
      description, 
      wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed',
      result.code, 
      setAppState, 
      toolUseId, 
      kind, 
      agentId
    )
    
    // 清理任务输出
    void evictTaskOutput(taskId)
  })
  
  return {
    taskId,
    cleanup: () => {
      unregisterCleanup()
    }
  }
}
```

### 2.2 LocalAgentTask（本地代理任务）

**文件**: `src/tasks/LocalAgentTask/LocalAgentTask.tsx`

```typescript
export type LocalAgentTaskState = TaskStateBase & {
  type: 'local_agent'
  prompt: string               // 代理提示词
  subagentType?: string        // 子代理类型
  model?: string               // 使用的模型
  outputFile: string           // 输出文件路径
  result?: string              // 执行结果
  isBackgrounded?: boolean     // 是否后台化
}

// 启动本地代理任务
export async function spawnLocalAgentTask(
  input: AgentTaskInput,
  context: TaskContext,
): Promise<TaskHandle> {
  const { description, prompt, subagentType, model, toolUseId } = input
  const { setAppState } = context

  const taskId = generateUUID()
  
  // 创建任务输出
  const taskOutput = new TaskOutput(taskId)
  
  // 创建任务状态
  const taskState: LocalAgentTaskState = {
    ...createTaskStateBase(taskId, 'local_agent', description, toolUseId),
    type: 'local_agent',
    status: 'running',
    prompt,
    subagentType,
    model,
    outputFile: taskOutput.path,
    startTime: Date.now(),
  }
  
  // 注册任务
  registerTask(taskState, setAppState)
  
  // 创建 QueryEngine
  const queryEngine = new QueryEngine({
    cwd: context.cwd,
    agentType: subagentType,
    model,
  })
  
  // 异步执行代理
  void (async () => {
    try {
      const messageStream = queryEngine.submitMessage(prompt)
      let result = ''
      
      for await (const message of messageStream) {
        if (message.type === 'text') {
          result += message.text
          await taskOutput.write(message)
        }
      }
      
      // 更新任务状态为完成
      updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
        ...task,
        status: 'completed',
        result,
        endTime: Date.now(),
      }))
      
      // 发送通知
      enqueueTaskNotification(taskId, 'completed', description)
      
    } catch (error) {
      // 更新任务状态为失败
      updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
        ...task,
        status: 'failed',
        result: String(error),
        endTime: Date.now(),
      }))
      
      enqueueTaskNotification(taskId, 'failed', description)
    }
  })()
  
  return {
    taskId,
    cleanup: () => {
      // 清理资源
    }
  }
}
```

### 2.3 RemoteAgentTask（远程代理任务）

**文件**: `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`

```typescript
export type RemoteAgentTaskState = TaskStateBase & {
  type: 'remote_agent'
  prompt: string
  subagentType?: string
  remoteEnvId: string          // 远程环境 ID
  outputFile: string
  result?: string
}

// 启动远程代理任务
export async function spawnRemoteAgentTask(
  input: RemoteAgentTaskInput,
  context: TaskContext,
): Promise<TaskHandle> {
  const { description, prompt, subagentType, remoteEnvId, toolUseId } = input
  const { setAppState } = context

  const taskId = generateUUID()
  
  // 创建任务输出
  const taskOutput = new TaskOutput(taskId)
  
  // 创建任务状态
  const taskState: RemoteAgentTaskState = {
    ...createTaskStateBase(taskId, 'remote_agent', description, toolUseId),
    type: 'remote_agent',
    status: 'running',
    prompt,
    subagentType,
    remoteEnvId,
    outputFile: taskOutput.path,
    startTime: Date.now(),
  }
  
  // 注册任务
  registerTask(taskState, setAppState)
  
  // 通过 API 启动远程代理
  const remoteTask = await api.spawnRemoteAgent({
    taskId,
    prompt,
    subagentType,
    remoteEnvId,
  })
  
  // 监听远程任务状态
  void (async () => {
    const result = await remoteTask.waitForCompletion()
    
    updateTaskState<RemoteAgentTaskState>(taskId, setAppState, task => ({
      ...task,
      status: result.status,
      result: result.output,
      endTime: Date.now(),
    }))
    
    enqueueTaskNotification(taskId, result.status, description)
  })()
  
  return {
    taskId,
    cleanup: () => {
      // 取消远程任务
      remoteTask.cancel()
    }
  }
}
```

---

## 三、Task 生命周期

### 3.1 生命周期状态图

```
┌─────────┐    create    ┌─────────┐   start    ┌─────────┐
│  idle   │ ───────────→ │ pending │ ─────────→ │ running │
└─────────┘              └─────────┘            └────┬────┘
                                                     │
              ┌──────────────────────────────────────┤
              │                                      │
              ↓                                      ↓
       ┌────────────┐                        ┌────────────┐
       │  killed    │ ←─────────────────────→│  failed    │
       └────────────┘                        └────────────┘
              ↑                                      ↑
              │                                      │
              └──────────────────────────────────────┘
                          completed
```

### 3.2 生命周期阶段详解

#### 阶段 1: 创建 (Create)

```typescript
// 创建任务状态基础
export function createTaskStateBase(
  taskId: string,
  type: TaskType,
  description: string,
  toolUseID?: string,
): TaskStateBase {
  return {
    id: taskId,
    type,
    status: 'pending',
    description,
    toolUseID,
  }
}

// 注册任务到状态管理
export function registerTask(
  taskState: TaskState,
  setAppState: SetAppState,
): void {
  setAppState(prev => ({
    ...prev,
    tasks: {
      ...prev.tasks,
      [taskState.id]: taskState,
    }
  }))
}
```

#### 阶段 2: 启动 (Start)

```typescript
// 更新任务状态为运行中
export function startTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  updateTaskState(taskId, setAppState, task => ({
    ...task,
    status: 'running',
    startTime: Date.now(),
  }))
}
```

#### 阶段 3: 运行 (Running)

```typescript
// 更新任务状态
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

#### 阶段 4: 完成 (Complete)

```typescript
// 完成任务
export function completeTask(
  taskId: string,
  setAppState: SetAppState,
  result?: unknown,
): void {
  updateTaskState(taskId, setAppState, task => ({
    ...task,
    status: 'completed',
    result,
    endTime: Date.now(),
  }))
}
```

#### 阶段 5: 失败 (Fail)

```typescript
// 标记任务失败
export function failTask(
  taskId: string,
  setAppState: SetAppState,
  error: string,
): void {
  updateTaskState(taskId, setAppState, task => ({
    ...task,
    status: 'failed',
    error,
    endTime: Date.now(),
  }))
}
```

#### 阶段 6: 终止 (Kill)

```typescript
// 终止任务
export async function killTask(
  taskId: string,
  setAppState: SetAppState,
): Promise<void> {
  const state = getAppState()
  const task = state.tasks[taskId]
  
  if (!task || (task.status !== 'running' && task.status !== 'pending')) {
    return
  }
  
  // 根据任务类型执行不同的终止逻辑
  switch (task.type) {
    case 'local_bash':
      await killShellTask(taskId, setAppState)
      break
    case 'local_agent':
      await killAgentTask(taskId, setAppState)
      break
    case 'remote_agent':
      await killRemoteTask(taskId, setAppState)
      break
    // ...
  }
  
  // 更新任务状态
  updateTaskState(taskId, setAppState, t => ({
    ...t,
    status: 'killed',
    endTime: Date.now(),
  }))
}
```

---

## 四、Task 框架

### 4.1 任务框架核心

**文件**: `src/utils/task/framework.ts`

```typescript
// 任务注册表
const taskRegistry = new Map<string, TaskHandle>()

// 注册任务
export function registerTask(
  taskState: TaskState,
  setAppState: SetAppState,
): void {
  // 更新应用状态
  setAppState(prev => ({
    ...prev,
    tasks: {
      ...prev.tasks,
      [taskState.id]: taskState,
    }
  }))
}

// 更新任务状态
export function updateTaskState<T extends TaskState>(
  taskId: string,
  setAppState: SetAppState,
  updater: (task: T) => T,
): void {
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!task) {
      logError(`Task ${taskId} not found`)
      return prev
    }
    
    const updatedTask = updater(task as T)
    
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: updatedTask,
      }
    }
  })
}

// 注销任务
export function unregisterTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  setAppState(prev => {
    const tasks = { ...prev.tasks }
    delete tasks[taskId]
    return {
      ...prev,
      tasks,
    }
  })
}

// 获取任务状态
export function getTaskState(
  taskId: string,
  getAppState: () => AppState,
): TaskState | undefined {
  return getAppState().tasks[taskId]
}
```

### 4.2 任务输出管理

**文件**: `src/utils/task/diskOutput.ts`

```typescript
// 任务输出类
export class TaskOutput {
  public readonly taskId: string
  public readonly path: string
  private writeStream?: WriteStream
  
  constructor(taskId?: string) {
    this.taskId = taskId ?? generateUUID()
    this.path = getTaskOutputPath(this.taskId)
  }
  
  // 写入数据
  async write(data: string | Buffer): Promise<void> {
    if (!this.writeStream) {
      await ensureDir(path.dirname(this.path))
      this.writeStream = createWriteStream(this.path)
    }
    
    return new Promise((resolve, reject) => {
      this.writeStream!.write(data, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
  
  // 读取输出
  async read(): Promise<string> {
    return readFile(this.path, 'utf-8')
  }
  
  // 关闭流
  async close(): Promise<void> {
    if (this.writeStream) {
      return new Promise((resolve, reject) => {
        this.writeStream!.end(() => resolve())
      })
    }
  }
}

// 获取任务输出路径
export function getTaskOutputPath(taskId: string): string {
  return path.join(getClaudeTempDir(), 'tasks', `${taskId}.log`)
}

// 清理任务输出
export async function evictTaskOutput(taskId: string): Promise<void> {
  const outputPath = getTaskOutputPath(taskId)
  try {
    await unlink(outputPath)
  } catch {
    // 文件可能不存在，忽略错误
  }
}
```

---

## 五、后台任务管理

### 5.1 前台转后台

```typescript
// 注册前台任务
export function registerForeground(
  input: LocalShellSpawnInput & {
    shellCommand: ShellCommand
  },
  setAppState: SetAppState,
  toolUseID?: string,
): string {
  const { command, description, shellCommand, agentId } = input
  const taskId = shellCommand.taskOutput.taskId
  
  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState)
  })
  
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseID),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: false,  // 前台任务
    agentId
  }
  
  registerTask(taskState, setAppState)
  return taskId
}

// 后台化任务
function backgroundTask(
  taskId: string,
  getAppState: () => AppState,
  setAppState: SetAppState,
): boolean {
  const state = getAppState()
  const task = state.tasks[taskId]
  
  if (!isLocalShellTask(task) || task.isBackgrounded || !task.shellCommand) {
    return false
  }
  
  const shellCommand = task.shellCommand
  
  // 后台化进程
  shellCommand.background(taskId)
  
  // 更新任务状态
  updateTaskState<LocalShellTaskState>(taskId, setAppState, t => ({
    ...t,
    isBackgrounded: true,
  }))
  
  // 启动停滞检测
  const cancelStallWatchdog = startStallWatchdog(
    taskId, 
    task.description, 
    task.kind, 
    task.toolUseID, 
    task.agentId
  )
  
  // 监听完成
  void shellCommand.result.then(async result => {
    cancelStallWatchdog()
    // ... 处理完成
  })
  
  return true
}
```

### 5.2 任务通知

```typescript
// 入队任务通知
export function enqueueTaskNotification(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  description: string,
): void {
  const summary = formatTaskSummary(taskId, status, description)
  
  enqueuePendingNotification({
    value: summary,
    mode: 'task-notification',
    priority: 'later',
  })
}

// 格式化任务摘要
function formatTaskSummary(
  taskId: string,
  status: 'completed' | 'failed' | 'killed',
  description: string,
): string {
  const outputPath = getTaskOutputPath(taskId)
  
  let summary: string
  switch (status) {
    case 'completed':
      summary = `Background task "${description}" completed`
      break
    case 'failed':
      summary = `Background task "${description}" failed`
      break
    case 'killed':
      summary = `Background task "${description}" was stopped`
      break
  }
  
  return `<task_notification>
<task_id>${taskId}</task_id>
<output_file>${outputPath}</output_file>
<status>${status}</status>
<summary>${summary}</summary>
</task_notification>`
}
```

---

## 六、任务停止机制

### 6.1 停止任务

**文件**: `src/tasks/stopTask.ts`

```typescript
export async function stopTask(
  taskId: string,
  setAppState: SetAppState,
): Promise<boolean> {
  const state = getAppState()
  const task = state.tasks[taskId]
  
  if (!task) {
    return false
  }
  
  // 只能停止运行中的任务
  if (task.status !== 'running' && task.status !== 'pending') {
    return false
  }
  
  // 根据任务类型执行停止
  switch (task.type) {
    case 'local_bash':
      return await stopShellTask(taskId, setAppState)
    case 'local_agent':
      return await stopAgentTask(taskId, setAppState)
    case 'remote_agent':
      return await stopRemoteTask(taskId, setAppState)
    default:
      return false
  }
}
```

### 6.2 停止 Shell 任务

**文件**: `src/tasks/LocalShellTask/killShellTasks.ts`

```typescript
export async function killTask(
  taskId: string,
  setAppState: SetAppState,
): Promise<void> {
  const state = getAppState()
  const task = state.tasks[taskId]
  
  if (!isLocalShellTask(task) || !task.shellCommand) {
    return
  }
  
  // 杀死进程
  task.shellCommand.kill()
  
  // 取消清理注册
  if (task.unregisterCleanup) {
    task.unregisterCleanup()
  }
  
  // 更新状态
  updateTaskState<LocalShellTaskState>(taskId, setAppState, t => ({
    ...t,
    status: 'killed',
    shellCommand: null,
    unregisterCleanup: undefined,
    endTime: Date.now(),
  }))
}

// 停止指定代理的所有 Shell 任务
export async function killShellTasksForAgent(
  agentId: AgentId,
  setAppState: SetAppState,
): Promise<void> {
  const state = getAppState()
  
  const agentTasks = Object.values(state.tasks).filter(
    (task): task is LocalShellTaskState =>
      isLocalShellTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
  )
  
  await Promise.all(
    agentTasks.map(task => killTask(task.id, setAppState))
  )
}
```

---

## 七、任务监控

### 7.1 停滞检测

```typescript
// 停滞检测参数
const STALL_CHECK_INTERVAL_MS = 5_000   // 检查间隔 5 秒
const STALL_THRESHOLD_MS = 45_000       // 停滞阈值 45 秒
const STALL_TAIL_BYTES = 1024           // 检查最后 1KB

// 提示符模式（检测交互式提示）
const PROMPT_PATTERNS = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\? *$/i,
  /Press (any key|Enter)/i,
  /Continue\?/i,
  /Overwrite\?/i,
]

// 检查是否像提示符
export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.trimEnd().split('\n').pop() ?? ''
  return PROMPT_PATTERNS.some(p => p.test(lastLine))
}

// 启动停滞检测
function startStallWatchdog(
  taskId: string,
  description: string,
  kind: BashTaskKind | undefined,
  toolUseId?: string,
  agentId?: AgentId,
): () => void {
  if (kind === 'monitor') return () => {}
  
  const outputPath = getTaskOutputPath(taskId)
  let lastSize = 0
  let lastGrowth = Date.now()
  let cancelled = false
  
  const timer = setInterval(() => {
    void stat(outputPath).then(s => {
      if (s.size > lastSize) {
        lastSize = s.size
        lastGrowth = Date.now()
        return
      }
      
      if (Date.now() - lastGrowth < STALL_THRESHOLD_MS) return
      
      void tailFile(outputPath, STALL_TAIL_BYTES).then(({ content }) => {
        if (cancelled) return
        if (!looksLikePrompt(content)) {
          lastGrowth = Date.now()
          return
        }
        
        cancelled = true
        clearInterval(timer)
        
        const summary = `Background command "${description}" appears to be waiting for interactive input`
        const message = `<task_notification>
<task_id>${taskId}</task_id>
<output_file>${outputPath}</output_file>
<summary>${escapeXml(summary)}</summary>
</task_notification>
Last output:
${content.trimEnd()}

The command is likely blocked on an interactive prompt. Kill this task and re-run with piped input or a non-interactive flag.`
        
        enqueuePendingNotification({
          value: message,
          mode: 'task-notification',
          priority: 'next',
          agentId
        })
      })
    })
  }, STALL_CHECK_INTERVAL_MS)
  
  timer.unref()
  
  return () => {
    cancelled = true
    clearInterval(timer)
  }
}
```

---

## 八、总结

Claude Code 的 Task 系统设计遵循以下原则：

1. **类型安全**: 使用 TypeScript 联合类型定义不同任务类型
2. **状态管理**: 集中式状态管理，支持状态订阅和更新
3. **生命周期管理**: 清晰的生命周期阶段和状态转换
4. **后台支持**: 支持前台任务转后台，异步执行
5. **资源管理**: 自动清理和资源释放
6. **通知机制**: 任务完成通知和停滞检测
7. **可扩展性**: 易于添加新的任务类型
