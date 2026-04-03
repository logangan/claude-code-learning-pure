# Claude Code 工具实现详解

本文档详细分析 Claude Code 中核心工具的实现逻辑和设计。

## 一、工具系统架构

### 1.1 工具接口定义

**文件**: `src/Tool.ts`

```typescript
export type Tool = {
  name: string
  description: string
  inputJSONSchema: ToolInputJSONSchema
  
  // 动态启用检查
  isEnabled: () => boolean
  
  // 权限相关
  isReadOnly: boolean
  needsPermissions: boolean
  
  // 提示词生成
  prompt: (context: ToolPromptContext) => Promise<string> | string
  
  // 核心执行方法
  call: (
    input: Record<string, unknown>,
    context: ToolUseContext,
    toolUseID: string,
    assistantMessage: AssistantMessage
  ) => AsyncGenerator<ToolYield, void, unknown>
}
```

### 1.2 工具构建器

```typescript
export function buildTool<Def extends ToolDef>(
  name: string,
  description: string,
  def: Def,
): Tool {
  return {
    name,
    description,
    inputJSONSchema: def.inputSchema,
    isEnabled: def.isEnabled ?? (() => true),
    isReadOnly: def.isReadOnly ?? false,
    needsPermissions: def.needsPermissions ?? true,
    prompt: def.prompt ?? (() => ''),
    call: async function* (
      input: Record<string, unknown>,
      context: ToolUseContext,
      toolUseID: string,
      assistantMessage: AssistantMessage,
    ): AsyncGenerator<ToolYield, void, unknown> {
      // 验证输入
      const validatedInput = def.inputSchema.parse(input)
      
      // 执行工具逻辑
      yield* def.call(validatedInput, context, toolUseID, assistantMessage)
    },
  }
}
```

---

## 二、Bash 工具实现

### 2.1 核心实现

**文件**: `src/tools/BashTool/BashTool.tsx`

```typescript
export const BashTool = buildTool(
  BASH_TOOL_NAME,
  'Execute bash commands',
  {
    inputSchema: fullInputSchema,
    isReadOnly: false,
    needsPermissions: true,
    
    async *call(input, context, toolUseID, assistantMessage) {
      const { command, timeout, description, run_in_background } = input
      
      // 1. 解析命令安全性
      const securityCheck = parseForSecurity(command)
      if (securityCheck.hasSecurityIssues) {
        yield {
          type: 'error',
          error: `Security check failed: ${securityCheck.reason}`,
        }
        return
      }
      
      // 2. 检查权限
      const permissionResult = await context.canUseTool(
        BashTool,
        input,
        context,
        toolUseID,
        assistantMessage,
      )
      
      if (permissionResult.behavior !== 'allow') {
        yield {
          type: 'error',
          error: 'Permission denied',
        }
        return
      }
      
      // 3. 创建 ShellCommand
      const shellCommand = new ShellCommand(command, {
        timeout: timeout ?? getDefaultTimeoutMs(),
        description,
        cwd: context.cwd,
      })
      
      // 4. 处理后台执行
      if (run_in_background) {
        const taskHandle = await spawnShellTask(
          {
            command,
            description,
            shellCommand,
            toolUseID,
          },
          context,
        )
        
        yield {
          type: 'result',
          result: {
            content: `Background task started: ${taskHandle.taskId}`,
          },
        }
        return
      }
      
      // 5. 前台执行
      yield {
        type: 'progress',
        message: `Executing: ${command}`,
      }
      
      // 6. 等待结果
      const result = await shellCommand.result
      
      // 7. 返回结果
      yield {
        type: 'result',
        result: {
          content: result.stdout,
          error: result.stderr,
          exitCode: result.code,
        },
      }
    },
  },
)
```

### 2.2 命令分类逻辑

```typescript
// 搜索命令
const BASH_SEARCH_COMMANDS = new Set([
  'find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis'
])

// 读取命令
const BASH_READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more',
  'wc', 'stat', 'file', 'strings',
  'jq', 'awk', 'cut', 'sort', 'uniq', 'tr'
])

// 列表命令
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du'])

// 静默命令（成功时无输出）
const BASH_SILENT_COMMANDS = new Set([
  'mv', 'cp', 'rm', 'mkdir', 'rmdir',
  'chmod', 'chown', 'chgrp', 'touch', 'ln',
  'cd', 'export', 'unset', 'wait'
])

// 检查命令类型
export function isSearchOrReadBashCommand(command: string): {
  isSearch: boolean
  isRead: boolean
  isList: boolean
} {
  // 解析命令
  const parts = splitCommandWithOperators(command)
  
  let hasSearch = false
  let hasRead = false
  let hasList = false
  
  for (const part of parts) {
    const baseCommand = part.trim().split(/\s+/)[0]
    
    if (BASH_SEARCH_COMMANDS.has(baseCommand)) {
      hasSearch = true
    } else if (BASH_READ_COMMANDS.has(baseCommand)) {
      hasRead = true
    } else if (BASH_LIST_COMMANDS.has(baseCommand)) {
      hasList = true
    }
  }
  
  return { isSearch, isRead, isList }
}
```

### 2.3 安全解析

```typescript
export function parseForSecurity(command: string): SecurityCheck {
  // 检查危险命令
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,
    />\s*\/dev\/null.*2>&1.*rm/,
    /curl.*\|.*bash/,
    /wget.*-O.*-\|.*bash/,
  ]
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        hasSecurityIssues: true,
        reason: 'Potentially dangerous command pattern detected',
      }
    }
  }
  
  // 检查环境变量泄露
  if (/\b(echo|print).*\$[A-Z_]+/.test(command)) {
    return {
      hasSecurityIssues: true,
      reason: 'Potential secret exposure',
    }
  }
  
  return { hasSecurityIssues: false }
}
```

---

## 三、文件读取工具实现

### 3.1 核心实现

**文件**: `src/tools/FileReadTool/FileReadTool.ts`

```typescript
export const FileReadTool = buildTool(
  FILE_READ_TOOL_NAME,
  DESCRIPTION,
  {
    inputSchema,
    isReadOnly: true,
    needsPermissions: true,
    
    async *call(input, context, toolUseID, assistantMessage) {
      const { file_path, offset, limit, pages } = input
      
      // 1. 检查是否是阻塞设备路径
      if (isBlockedDevicePath(file_path)) {
        yield {
          type: 'error',
          error: `Cannot read device file: ${file_path}`,
        }
        return
      }
      
      // 2. 检查权限
      const permissionResult = await context.canUseTool(
        FileReadTool,
        input,
        context,
        toolUseID,
        assistantMessage,
      )
      
      if (permissionResult.behavior !== 'allow') {
        yield {
          type: 'error',
          error: 'Permission denied',
        }
        return
      }
      
      // 3. 检查文件是否存在
      const fileExists = await checkFileExists(file_path)
      if (!fileExists) {
        // 尝试查找相似文件
        const similarFile = await findSimilarFile(file_path)
        yield {
          type: 'error',
          error: similarFile
            ? `File not found. Did you mean: ${similarFile}?`
            : `File not found: ${file_path}`,
        }
        return
      }
      
      // 4. 检查文件类型
      const fileType = await detectFileType(file_path)
      
      // 5. 处理 PDF 文件
      if (fileType === 'pdf') {
        yield* readPDFFile(file_path, pages, context)
        return
      }
      
      // 6. 处理图片文件
      if (fileType === 'image') {
        yield* readImageFile(file_path, context)
        return
      }
      
      // 7. 处理 Notebook 文件
      if (fileType === 'notebook') {
        yield* readNotebookFile(file_path, context)
        return
      }
      
      // 8. 读取文本文件
      yield* readTextFile(file_path, offset, limit, context)
    },
  },
)
```

### 3.2 文件类型检测

```typescript
async function detectFileType(filePath: string): Promise<FileType> {
  const ext = path.extname(filePath).toLowerCase()
  
  // 图片类型
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  
  // PDF 类型
  if (ext === '.pdf') {
    return 'pdf'
  }
  
  // Notebook 类型
  if (ext === '.ipynb') {
    return 'notebook'
  }
  
  // 检查是否为二进制文件
  if (hasBinaryExtension(ext)) {
    return 'binary'
  }
  
  return 'text'
}
```

### 3.3 图片处理

```typescript
async function* readImageFile(
  filePath: string,
  context: ToolUseContext,
): AsyncGenerator<ToolYield, void, unknown> {
  // 读取图片文件
  const buffer = await readFile(filePath)
  
  // 检测图片格式
  const format = detectImageFormatFromBuffer(buffer)
  
  // 调整图片大小和压缩
  const processedBuffer = await maybeResizeAndDownsampleImageBuffer(
    buffer,
    format,
    MAX_IMAGE_DIMENSIONS,
  )
  
  // 转换为 base64
  const base64 = processedBuffer.toString('base64')
  
  // 创建图片元数据
  const metadata = createImageMetadataText(filePath, format)
  
  yield {
    type: 'result',
    result: {
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: `image/${format}`,
            data: base64,
          },
        },
        {
          type: 'text',
          text: metadata,
        },
      ],
    },
  }
}
```

### 3.4 PDF 处理

```typescript
async function* readPDFFile(
  filePath: string,
  pages: string | undefined,
  context: ToolUseContext,
): AsyncGenerator<ToolYield, void, unknown> {
  // 获取 PDF 页数
  const pageCount = await getPDFPageCount(filePath)
  
  // 解析页码范围
  const pageRange = pages
    ? parsePDFPageRange(pages, pageCount)
    : { start: 1, end: Math.min(pageCount, PDF_MAX_PAGES_PER_READ) }
  
  // 检查页数限制
  if (pageRange.end - pageRange.start + 1 > PDF_MAX_PAGES_PER_READ) {
    yield {
      type: 'error',
      error: `Too many pages requested. Maximum is ${PDF_MAX_PAGES_PER_READ} pages per request.`,
    }
    return
  }
  
  // 提取页面内容
  const content = await extractPDFPages(filePath, pageRange)
  
  yield {
    type: 'result',
    result: {
      content: `PDF pages ${pageRange.start}-${pageRange.end}:\n\n${content}`,
    },
  }
}
```

---

## 四、文件编辑工具实现

### 4.1 核心实现

**文件**: `src/tools/FileEditTool/FileEditTool.ts`

```typescript
export const FileEditTool = buildTool(
  FILE_EDIT_TOOL_NAME,
  getEditToolDescription(),
  {
    inputSchema,
    isReadOnly: false,
    needsPermissions: true,
    
    async *call(input, context, toolUseID, assistantMessage) {
      const { file_path, old_string, new_string, replace_all } = input
      
      // 1. 检查是否已读取文件
      if (!context.readFileState.hasReadFile(file_path)) {
        yield {
          type: 'error',
          error: `You must read the file before editing. Use ${FILE_READ_TOOL_NAME} first.`,
        }
        return
      }
      
      // 2. 检查权限
      const permissionResult = await context.canUseTool(
        FileEditTool,
        input,
        context,
        toolUseID,
        assistantMessage,
      )
      
      if (permissionResult.behavior !== 'allow') {
        yield {
          type: 'error',
          error: 'Permission denied',
        }
        return
      }
      
      // 3. 读取当前文件内容
      const content = await readFile(file_path, 'utf-8')
      
      // 4. 查找 old_string
      const occurrences = countOccurrences(content, old_string)
      
      if (occurrences === 0) {
        yield {
          type: 'error',
          error: `String not found in file: ${old_string.substring(0, 50)}...`,
        }
        return
      }
      
      if (occurrences > 1 && !replace_all) {
        yield {
          type: 'error',
          error: `String appears ${occurrences} times. Use replace_all to replace all occurrences or provide more context to make it unique.`,
        }
        return
      }
      
      // 5. 执行替换
      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string)
      
      // 6. 写入文件
      await writeFile(file_path, newContent, 'utf-8')
      
      // 7. 跟踪文件历史
      if (fileHistoryEnabled()) {
        await fileHistoryTrackEdit(
          context.updateFileHistoryState,
          file_path,
          assistantMessage.id,
        )
      }
      
      // 8. 通知 VSCode
      notifyVscodeFileUpdated(file_path)
      
      yield {
        type: 'result',
        result: {
          content: `Successfully edited ${file_path}`,
        },
      }
    },
  },
)
```

### 4.2 字符串匹配逻辑

```typescript
function countOccurrences(content: string, search: string): number {
  let count = 0
  let pos = 0
  
  while ((pos = content.indexOf(search, pos)) !== -1) {
    count++
    pos += search.length
  }
  
  return count
}

function findBestMatch(
  content: string,
  oldString: string,
): { match: string; confidence: number } | null {
  // 如果精确匹配，直接返回
  if (content.includes(oldString)) {
    return { match: oldString, confidence: 1.0 }
  }
  
  // 尝试模糊匹配
  const lines = content.split('\n')
  const oldLines = oldString.split('\n')
  
  for (let i = 0; i <= lines.length - oldLines.length; i++) {
    const candidate = lines.slice(i, i + oldLines.length).join('\n')
    const similarity = calculateSimilarity(candidate, oldString)
    
    if (similarity > 0.8) {
      return { match: candidate, confidence: similarity }
    }
  }
  
  return null
}
```

---

## 五、Agent 工具实现

### 5.1 核心实现

**文件**: `src/tools/AgentTool/AgentTool.tsx`

```typescript
export const AgentTool = buildTool(
  AGENT_TOOL_NAME,
  'Launch specialized agents to handle complex tasks',
  {
    inputSchema: fullInputSchema,
    isReadOnly: false,
    needsPermissions: true,
    
    async *call(input, context, toolUseID, assistantMessage) {
      const {
        description,
        prompt,
        subagent_type,
        model,
        run_in_background,
        isolation,
        name,
      } = input
      
      // 1. 检查权限
      const permissionResult = await context.canUseTool(
        AgentTool,
        input,
        context,
        toolUseID,
        assistantMessage,
      )
      
      if (permissionResult.behavior !== 'allow') {
        yield {
          type: 'error',
          error: 'Permission denied',
        }
        return
      }
      
      // 2. 确定执行模式
      if (isolation === 'worktree') {
        // Fork 子代理模式
        yield* forkSubagent(input, context, toolUseID)
        return
      }
      
      if (isolation === 'remote') {
        // 远程执行模式
        yield* spawnRemoteAgent(input, context, toolUseID)
        return
      }
      
      if (run_in_background) {
        // 后台执行模式
        yield* spawnBackgroundAgent(input, context, toolUseID)
        return
      }
      
      // 3. 同步执行模式
      yield* runAgentSynchronously(input, context, toolUseID)
    },
  },
)
```

### 5.2 Fork 子代理

```typescript
async function* forkSubagent(
  input: AgentToolInput,
  context: ToolUseContext,
  toolUseID: string,
): AsyncGenerator<ToolYield, void, unknown> {
  const { description, prompt, name } = input
  
  // 1. 创建 git worktree
  const worktreeDir = await createWorktree(context.cwd)
  
  // 2. 创建新的 QueryEngine
  const queryEngine = new QueryEngine({
    cwd: worktreeDir,
    parentContext: context,
  })
  
  // 3. 提交消息给子代理
  const messageStream = queryEngine.submitMessage(prompt)
  
  // 4. 收集结果
  let result = ''
  for await (const message of messageStream) {
    if (message.type === 'text') {
      result += message.text
    }
  }
  
  // 5. 检查是否有更改
  const hasChanges = await checkWorktreeChanges(worktreeDir)
  
  if (hasChanges) {
    // 返回 worktree 路径和分支
    yield {
      type: 'result',
      result: {
        content: result,
        worktreeDir,
        branch: await getWorktreeBranch(worktreeDir),
      },
    }
  } else {
    // 清理 worktree
    await cleanupWorktree(worktreeDir)
    
    yield {
      type: 'result',
      result: {
        content: result,
      },
    }
  }
}
```

### 5.3 后台代理

```typescript
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
  
  // 4. 启动代理
  const queryEngine = new QueryEngine({
    cwd: context.cwd,
  })
  
  // 5. 异步执行
  void (async () => {
    const messageStream = queryEngine.submitMessage(prompt)
    
    for await (const message of messageStream) {
      await taskOutput.write(message)
    }
    
    // 6. 完成任务
    completeTask(agentTask.id, context.setAppState)
    
    // 7. 发送通知
    enqueueTaskNotification(agentTask.id, 'completed')
  })()
  
  yield {
    type: 'result',
    result: {
      content: `Background agent started: ${agentTask.id}`,
      taskId: agentTask.id,
      outputFile: taskOutput.path,
    },
  }
}
```

---

## 六、工具权限系统

### 6.1 权限检查流程

```typescript
export async function canUseTool(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
  toolUseID: string,
  assistantMessage: AssistantMessage,
): Promise<PermissionResult> {
  // 1. 检查全局权限模式
  const mode = context.permissionMode
  
  if (mode === 'bypassPermissions') {
    return { behavior: 'allow' }
  }
  
  if (mode === 'acceptEdits' && tool.isReadOnly) {
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
  
  for (const rule of rules.alwaysAsk) {
    if (matchesRule(tool, input, rule)) {
      return { behavior: 'ask', rule }
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

### 6.2 规则匹配

```typescript
function matchesRule(
  tool: Tool,
  input: Record<string, unknown>,
  rule: PermissionRule,
): boolean {
  // 检查工具名称
  if (rule.toolName && rule.toolName !== tool.name) {
    return false
  }
  
  // 检查命令模式（Bash 工具）
  if (rule.commandPattern && input.command) {
    const command = input.command as string
    const regex = new RegExp(rule.commandPattern)
    if (!regex.test(command)) {
      return false
    }
  }
  
  // 检查文件路径模式
  if (rule.filePattern) {
    const filePath = (input.file_path || input.path) as string
    if (!filePath) return false
    
    const regex = new RegExp(rule.filePattern)
    if (!regex.test(filePath)) {
      return false
    }
  }
  
  return true
}
```

---

## 七、工具结果处理

### 7.1 结果存储

```typescript
export async function ensureToolResultsDir(): Promise<string> {
  const dir = path.join(getClaudeTempDir(), 'tool-results')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function getToolResultPath(toolUseID: string): Promise<string> {
  const dir = await ensureToolResultsDir()
  return path.join(dir, `${toolUseID}.json`)
}

export async function saveToolResult(
  toolUseID: string,
  result: ToolResult,
): Promise<void> {
  const filePath = await getToolResultPath(toolUseID)
  await writeFile(filePath, JSON.stringify(result), 'utf-8')
}
```

### 7.2 大型结果处理

```typescript
export function buildLargeToolResultMessage(
  content: string,
  maxLength: number = TOOL_SUMMARY_MAX_LENGTH,
): {
  content: string
  isTruncated: boolean
  fullResultPath: string
} {
  // 检查内容长度
  if (content.length <= maxLength) {
    return {
      content,
      isTruncated: false,
      fullResultPath: '',
    }
  }
  
  // 截断内容
  const truncated = content.substring(0, maxLength)
  const summary = `${truncated}\n\n[Output truncated. Full result saved to: ${fullResultPath}]`
  
  // 保存完整结果
  const fullResultPath = saveFullResult(content)
  
  return {
    content: summary,
    isTruncated: true,
    fullResultPath,
  }
}
```

---

## 八、工具设计模式

### 8.1 异步生成器模式

所有工具都使用 `AsyncGenerator` 实现流式输出：

```typescript
async function* toolCall(
  input: Input,
  context: ToolUseContext,
): AsyncGenerator<ToolYield, void, unknown> {
  // 产出进度更新
  yield { type: 'progress', message: 'Starting...' }
  
  // 执行操作
  const result = await doSomething()
  
  // 产出中间结果
  yield { type: 'progress', message: 'Halfway done...' }
  
  // 完成
  yield { type: 'result', result }
}
```

### 8.2 权限拦截模式

工具调用通过 `canUseTool` 函数进行权限检查：

```typescript
const wrappedCanUseTool: CanUseToolFn = async (...args) => {
  const result = await canUseTool(...args)
  
  // 记录权限拒绝
  if (result.behavior !== 'allow') {
    logPermissionDenial(args, result)
  }
  
  return result
}
```

### 8.3 上下文传递模式

工具通过 `ToolUseContext` 获取执行环境：

```typescript
export type ToolUseContext = {
  cwd: string                    // 当前工作目录
  options: CLIOptions           // CLI 选项
  canUseTool: CanUseToolFn      // 权限检查函数
  readFileState: FileReadState  // 文件读取状态
  updateFileHistoryState: ...   // 文件历史更新
  setAppState: SetAppState      // 应用状态更新
  // ...
}
```

---

## 九、总结

Claude Code 的工具系统设计遵循以下原则：

1. **统一的接口**: 所有工具实现相同的 `Tool` 接口
2. **流式输出**: 使用 `AsyncGenerator` 实现实时进度反馈
3. **权限控制**: 细粒度的权限检查和规则系统
4. **安全性**: 输入验证、安全解析、危险操作检测
5. **可扩展性**: 通过 `buildTool` 构建器轻松添加新工具
6. **错误处理**: 完善的错误处理和用户友好的错误消息
