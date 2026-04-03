# Claude Code 详细技术分析报告

## 一、Agent 工具实现原理和方式

### 1.1 AgentTool 架构设计

AgentTool 是 Claude Code 的核心工具之一，用于创建和管理 AI 代理任务。它支持同步执行、异步后台执行、远程执行等多种模式。

#### 核心实现文件
- `src/tools/AgentTool/AgentTool.tsx` - 主实现
- `src/tools/AgentTool/runAgent.ts` - 代理运行逻辑
- `src/tools/AgentTool/forkSubagent.ts` - Fork 子代理
- `src/tools/AgentTool/agentToolUtils.ts` - 工具函数
- `src/tools/AgentTool/builtInAgents.ts` - 内置代理定义

#### 输入输出 Schema

```typescript
// 基础输入 Schema
const baseInputSchema = z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  subagent_type: z.string().optional().describe('The type of specialized agent to use'),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  run_in_background: z.boolean().optional().describe('Set to true to run this agent in the background')
});

// 完整输入 Schema（包含多代理参数）
const fullInputSchema = baseInputSchema.extend({
  name: z.string().optional().describe('Name for the spawned agent'),
  team_name: z.string().optional().describe('Team name for spawning'),
  mode: permissionModeSchema().optional(),
  isolation: z.enum(['worktree', 'remote']).optional(),
  cwd: z.string().optional().describe('Absolute path to run the agent in')
});

// 输出 Schema
const outputSchema = z.union([
  z.object({
    status: z.literal('completed'),
    prompt: z.string()
  }),
  z.object({
    status: z.literal('async_launched'),
    agentId: z.string(),
    description: z.string(),
    prompt: z.string(),
    outputFile: z.string(),
    canReadOutputFile: z.boolean().optional()
  })
]);
```

#### AgentTool 执行流程

```
用户调用 AgentTool
    ↓
解析输入参数
    ↓
检查执行模式
    ├─ run_in_background=true → 异步执行
    ├─ isolation='worktree' → Fork 子代理
    ├─ isolation='remote' → 远程执行
    └─ 默认 → 同步执行
    ↓
创建代理任务
    ↓
执行代理逻辑
    ↓
返回结果
```

#### 关键功能特性

1. **同步执行模式**
   - 在当前会话中执行代理任务
   - 实时返回执行结果
   - 支持进度显示

2. **异步后台执行**
   - 创建后台任务
   - 通过 TaskOutputTool 获取结果
   - 支持任务状态查询

3. **Fork 子代理**
   - 创建独立的 git worktree
   - 隔离的文件系统环境
   - 适合并行开发任务

4. **远程执行**
   - 在远程 CCR 环境中执行
   - 适合长时间运行的任务
   - 自动后台化

### 1.2 内置代理类型

```typescript
// 内置代理定义
export function getBuiltInAgents(): AgentDefinition[] {
  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,      // 通用目的代理
    STATUSLINE_SETUP_AGENT,     // 状态栏设置代理
  ];

  if (areExplorePlanAgentsEnabled()) {
    agents.push(
      EXPLORE_AGENT,              // 探索代理
      PLAN_AGENT                  // 计划代理
    );
  }

  // 代码指南代理（非 SDK 入口点）
  if (isNonSdkEntrypoint) {
    agents.push(CLAUDE_CODE_GUIDE_AGENT);
  }

  // 验证代理（特性开关控制）
  if (feature('VERIFICATION_AGENT')) {
    agents.push(VERIFICATION_AGENT);
  }

  return agents;
}
```

#### 内置代理说明

| 代理名称 | 功能描述 | 启用条件 |
|---------|---------|---------|
| **General Purpose Agent** | 通用目的代理，处理各种任务 | 始终启用 |
| **Statusline Setup Agent** | 状态栏设置代理 | 始终启用 |
| **Explore Agent** | 代码库探索代理 | `BUILTIN_EXPLORE_PLAN_AGENTS` |
| **Plan Agent** | 计划制定代理 | `BUILTIN_EXPLORE_PLAN_AGENTS` |
| **Claude Code Guide Agent** | Claude Code 使用指南 | 非 SDK 入口点 |
| **Verification Agent** | 验证代理 | `VERIFICATION_AGENT` |

---

## 二、工具系统详解

### 2.1 工具总数和分类

Claude Code 共定义了 **40+ 个工具**，分为以下几类：

#### 核心工具（始终启用）

| 工具名称 | 功能描述 | 文件位置 |
|---------|---------|---------|
| **AgentTool** | 创建和管理 AI 代理 | `tools/AgentTool/AgentTool.tsx` |
| **BashTool** | 执行 Bash 命令 | `tools/BashTool/BashTool.tsx` |
| **FileReadTool** | 读取文件内容 | `tools/FileReadTool/FileReadTool.ts` |
| **FileEditTool** | 编辑文件 | `tools/FileEditTool/FileEditTool.ts` |
| **FileWriteTool** | 写入文件 | `tools/FileWriteTool/FileWriteTool.ts` |
| **GlobTool** | 文件模式匹配 | `tools/GlobTool/GlobTool.ts` |
| **GrepTool** | 文本搜索 | `tools/GrepTool/GrepTool.ts` |
| **WebSearchTool** | Web 搜索 | `tools/WebSearchTool/WebSearchTool.ts` |
| **WebFetchTool** | 网页获取 | `tools/WebFetchTool/WebFetchTool.ts` |
| **TodoWriteTool** | 待办事项管理 | `tools/TodoWriteTool/TodoWriteTool.ts` |
| **ExitPlanModeV2Tool** | 退出计划模式 | `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` |
| **EnterPlanModeTool** | 进入计划模式 | `tools/EnterPlanModeTool/EnterPlanModeTool.ts` |
| **AskUserQuestionTool** | 询问用户 | `tools/AskUserQuestionTool/AskUserQuestionTool.tsx` |
| **SkillTool** | 执行技能 | `tools/SkillTool/SkillTool.ts` |
| **TaskStopTool** | 停止任务 | `tools/TaskStopTool/TaskStopTool.ts` |
| **TaskOutputTool** | 获取任务输出 | `tools/TaskOutputTool/TaskOutputTool.tsx` |
| **NotebookEditTool** | 编辑 Notebook | `tools/NotebookEditTool/NotebookEditTool.ts` |
| **ListMcpResourcesTool** | 列出 MCP 资源 | `tools/ListMcpResourcesTool/ListMcpResourcesTool.ts` |
| **ReadMcpResourceTool** | 读取 MCP 资源 | `tools/ReadMcpResourceTool/ReadMcpResourceTool.ts` |
| **ToolSearchTool** | 工具搜索 | `tools/ToolSearchTool/ToolSearchTool.ts` |

#### 条件启用工具（Feature Flag 控制）

| 工具名称 | 功能描述 | Feature Flag |
|---------|---------|-------------|
| **PowerShellTool** | 执行 PowerShell 命令 | 平台相关 |
| **LSPTool** | LSP 语言服务器 | `ENABLE_LSP_TOOL` |
| **TungstenTool** | Tmux 终端工具 | `USER_TYPE === 'ant'` |
| **REPLTool** | REPL 交互环境 | `USER_TYPE === 'ant'` |
| **WebBrowserTool** | Web 浏览器 | `WEB_BROWSER_TOOL` |
| **TaskCreateTool** | 创建任务 | `isTodoV2Enabled()` |
| **TaskGetTool** | 获取任务 | `isTodoV2Enabled()` |
| **TaskUpdateTool** | 更新任务 | `isTodoV2Enabled()` |
| **TaskListTool** | 列出任务 | `isTodoV2Enabled()` |
| **TeamCreateTool** | 创建团队 | `isAgentSwarmsEnabled()` |
| **TeamDeleteTool** | 删除团队 | `isAgentSwarmsEnabled()` |
| **SendMessageTool** | 发送消息 | `isAgentSwarmsEnabled()` |
| **EnterWorktreeTool** | 进入 Worktree | `isWorktreeModeEnabled()` |
| **ExitWorktreeTool** | 退出 Worktree | `isWorktreeModeEnabled()` |
| **CronCreateTool** | 创建定时任务 | `AGENT_TRIGGERS` |
| **CronDeleteTool** | 删除定时任务 | `AGENT_TRIGGERS` |
| **CronListTool** | 列出定时任务 | `AGENT_TRIGGERS` |
| **RemoteTriggerTool** | 远程触发 | `AGENT_TRIGGERS_REMOTE` |
| **MonitorTool** | 监控工具 | `MONITOR_TOOL` |
| **SleepTool** | 睡眠工具 | `PROACTIVE \|\| KAIROS` |
| **BriefTool** | 简报工具 | 始终启用 |
| **SnipTool** | 剪贴工具 | `HISTORY_SNIP` |
| **WorkflowTool** | 工作流工具 | `WORKFLOW_SCRIPTS` |
| **CtxInspectTool** | 上下文检查 | `CONTEXT_COLLAPSE` |
| **TerminalCaptureTool** | 终端捕获 | `TERMINAL_PANEL` |
| **OverflowTestTool** | 溢出测试 | `OVERFLOW_TEST_TOOL` |
| **ListPeersTool** | 列出对等节点 | `UDS_INBOX` |
| **SendUserFileTool** | 发送用户文件 | `KAIROS` |
| **PushNotificationTool** | 推送通知 | `KAIROS \|\| KAIROS_PUSH_NOTIFICATION` |
| **SubscribePRTool** | 订阅 PR | `KAIROS_GITHUB_WEBHOOKS` |
| **SuggestBackgroundPRTool** | 建议后台 PR | `USER_TYPE === 'ant'` |
| **VerifyPlanExecutionTool** | 验证计划执行 | `CLAUDE_CODE_VERIFY_PLAN` |

### 2.2 工具接口设计

```typescript
export type Tool = {
  name: string;
  description: string;
  inputJSONSchema: ToolInputJSONSchema;
  
  // 动态启用检查
  isEnabled: () => boolean;
  
  // 权限相关
  isReadOnly: boolean;
  needsPermissions: boolean;
  
  // 提示词生成
  prompt: (context: ToolPromptContext) => Promise<string> | string;
  
  // 核心执行方法
  call: (
    input: Record<string, unknown>,
    context: ToolUseContext,
    toolUseID: string,
    assistantMessage: AssistantMessage
  ) => AsyncGenerator<ToolYield, void, unknown>;
};
```

### 2.3 工具权限控制

```typescript
// 代理禁止使用的工具
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,
  EXIT_PLAN_MODE_V2_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ...(process.env.USER_TYPE === 'ant' ? [] : [AGENT_TOOL_NAME]),
  ASK_USER_QUESTION_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  ...(feature('WORKFLOW_SCRIPTS') ? [WORKFLOW_TOOL_NAME] : []),
]);

// 异步代理允许使用的工具
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  GREP_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  GLOB_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
  SKILL_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
]);

// 协调器模式允许的工具
export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
]);
```

---

## 三、斜杠命令系统

### 3.1 斜杠命令设计原理

斜杠命令（Slash Commands）是 Claude Code 的用户交互接口，通过 `/command` 的形式触发特定功能。

#### 命令类型定义

```typescript
export type Command = CommandBase &
  (PromptCommand | LocalCommand | LocalJSXCommand);

type CommandBase = {
  name: string;
  description: string;
  aliases?: string[];
  isEnabled?: () => boolean;
  isHidden?: boolean;
  availability?: CommandAvailability[];
  source: SettingSource | 'builtin' | 'mcp' | 'bundled' | 'plugin';
};

// Prompt 命令 - 生成提示词发送给 AI
export type PromptCommand = {
  type: 'prompt';
  progressMessage: string;
  getPromptForCommand(
    args: string,
    context: ToolUseContext
  ): Promise<ContentBlockParam[]>;
};

// 本地命令 - 本地执行，不经过 AI
export type LocalCommand = {
  type: 'local';
  supportsNonInteractive: boolean;
  load: () => Promise<LocalCommandModule>;
};

// 本地 JSX 命令 - 本地执行并渲染 React 组件
export type LocalJSXCommand = {
  type: 'local-jsx';
  load: () => Promise<LocalJSXCommandModule>;
};
```

### 3.2 命令注册机制

```typescript
// 命令注册示例
const COMMANDS = memoize((): Command[] => [
  addDir,           // /add-dir
  advisor,          // /advisor
  agents,           // /agents
  branch,           // /branch
  btw,              // /btw
  chrome,           // /chrome
  clear,            // /clear
  color,            // /color
  compact,          // /compact
  config,           // /config
  copy,             // /copy
  desktop,          // /desktop
  context,          // /context
  cost,             // /cost
  diff,             // /diff
  doctor,           // /doctor
  effort,           // /effort
  exit,             // /exit
  fast,             // /fast
  files,            // /files
  heapDump,         // /heapdump
  help,             // /help
  ide,              // /ide
  init,             // /init
  keybindings,      // /keybindings
  login,            // /login
  logout,           // /logout
  mcp,              // /mcp
  memory,           // /memory
  mobile,           // /mobile
  model,            // /model
  outputStyle,      // /output-style
  remoteEnv,        // /remote-env
  plugin,           // /plugin
  pr_comments,      // /pr-comments
  releaseNotes,     // /release-notes
  reloadPlugins,    // /reload-plugins
  rename,           // /rename
  resume,           // /resume
  session,          // /session
  skills,           // /skills
  // ... 更多命令
]);
```

### 3.3 完整斜杠命令列表

#### 基础命令

| 命令 | 类型 | 功能描述 |
|------|------|---------|
| `/help` | local-jsx | 显示帮助信息 |
| `/exit` | local-jsx | 退出程序 |
| `/clear` | local | 清除屏幕 |
| `/config` | local-jsx | 配置管理 |
| `/doctor` | local-jsx | 诊断检查 |
| `/version` | local | 显示版本 |

#### 文件操作命令

| 命令 | 类型 | 功能描述 |
|------|------|---------|
| `/files` | prompt | 文件管理 |
| `/diff` | local-jsx | 显示差异 |
| `/rewind` | local | 回滚文件 |
| `/compact` | prompt | 压缩历史 |

#### 任务和代理命令

| 命令 | 类型 | 功能描述 |
|------|------|---------|
| `/agents` | local-jsx | 代理管理 |
| `/tasks` | local-jsx | 任务管理 |
| `/memory` | local-jsx | 记忆管理 |

#### 模型和设置命令

| 命令 | 类型 | 功能描述 |
|------|------|---------|
| `/model` | local-jsx | 模型切换 |
| `/cost` | local-jsx | 成本统计 |
| `/usage` | local-jsx | 使用情况 |
| `/effort` | local-jsx | 努力程度设置 |

#### 开发工具命令

| 命令 | 类型 | 功能描述 |
|------|------|---------|
| `/commit` | prompt | 提交代码 |
| `/branch` | local | 分支管理 |
| `/ide` | local-jsx | IDE 集成 |
| `/mcp` | local-jsx | MCP 管理 |
| `/plugin` | local-jsx | 插件管理 |

#### 高级功能命令（Feature Flag 控制）

| 命令 | 类型 | 功能描述 | Feature Flag |
|------|------|---------|-------------|
| `/voice` | local-jsx | 语音模式 | `VOICE_MODE` |
| `/brief` | prompt | 简报模式 | `KAIROS \|\| KAIROS_BRIEF` |
| `/assistant` | local-jsx | 助手模式 | `KAIROS` |
| `/bridge` | local-jsx | 桥接模式 | `BRIDGE_MODE` |
| `/proactive` | prompt | 主动模式 | `PROACTIVE` |
| `/ultraplan` | prompt | 超级计划 | `ULTRAPLAN` |
| `/torch` | local | Torch 工具 | `TORCH` |
| `/peers` | local-jsx | 对等节点 | `UDS_INBOX` |
| `/fork` | local-jsx | Fork 子代理 | `FORK_SUBAGENT` |
| `/buddy` | local-jsx | 伙伴精灵 | `BUDDY` |
| `/workflows` | local-jsx | 工作流 | `WORKFLOW_SCRIPTS` |

### 3.4 命令执行流程

```
用户输入 /command
    ↓
解析命令名称和参数
    ↓
查找命令定义
    ↓
检查命令可用性
    ├─ isEnabled() → false → 显示错误
    └─ isEnabled() → true → 继续
    ↓
根据命令类型执行
    ├─ PromptCommand → 生成提示词 → 发送给 AI
    ├─ LocalCommand → 本地执行 → 返回结果
    └─ LocalJSXCommand → 加载组件 → 渲染 UI
    ↓
显示执行结果
```

---

## 四、Feature Flag 系统

### 4.1 Feature Flag 实现原理

Feature Flag 使用 Bun 的 `bun:bundle` 特性实现编译时条件编译：

```typescript
import { feature } from 'bun:bundle';

// 使用方式
if (feature('FEATURE_NAME')) {
  // 特性启用时的代码
}

// 或者用于条件导入
const module = feature('FEATURE_NAME')
  ? require('./module.js')
  : null;
```

### 4.2 完整 Feature Flag 列表

#### 核心功能 Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **KAIROS** | 助手模式主开关 | AI 助手功能 |
| **KAIROS_BRIEF** | 简报模式 | 简化输出 |
| **KAIROS_CHANNELS** | 多频道支持 | 频道管理 |
| **KAIROS_PUSH_NOTIFICATION** | 推送通知 | 消息推送 |
| **KAIROS_GITHUB_WEBHOOKS** | GitHub Webhooks | PR 订阅 |
| **PROACTIVE** | 主动模式 | 主动建议 |

#### 代理和任务 Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **AGENT_TRIGGERS** | 代理触发器 | 定时任务 |
| **AGENT_TRIGGERS_REMOTE** | 远程代理触发 | 远程触发 |
| **AGENT_MEMORY_SNAPSHOT** | 代理记忆快照 | 记忆管理 |
| **ENABLE_AGENT_SWARMS** | 代理集群 | 多代理协作 |
| **COORDINATOR_MODE** | 协调器模式 | 代理协调 |
| **FORK_SUBAGENT** | Fork 子代理 | 隔离执行 |
| **BUILTIN_EXPLORE_PLAN_AGENTS** | 内置探索/计划代理 | 代理类型 |
| **VERIFICATION_AGENT** | 验证代理 | 代码验证 |

#### 桥接和远程 Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **BRIDGE_MODE** | 桥接模式 | 远程连接 |
| **DAEMON** | 守护进程 | 后台服务 |
| **DIRECT_CONNECT** | 直接连接 | 点对点连接 |
| **SSH_REMOTE** | SSH 远程 | SSH 连接 |
| **CCR_MIRROR** | CCR 镜像 | 会话镜像 |
| **CCR_REMOTE_SETUP** | 远程设置 | 远程配置 |

#### 工具和 UI Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **WEB_BROWSER_TOOL** | Web 浏览器工具 | 网页浏览 |
| **VOICE_MODE** | 语音模式 | 语音交互 |
| **TERMINAL_PANEL** | 终端面板 | Tmux 集成 |
| **HISTORY_SNIP** | 历史剪贴 | 上下文管理 |
| **CONTEXT_COLLAPSE** | 上下文折叠 | 内存优化 |
| **WORKFLOW_SCRIPTS** | 工作流脚本 | 自动化 |
| **OVERFLOW_TEST_TOOL** | 溢出测试工具 | 测试 |
| **MONITOR_TOOL** | 监控工具 | 系统监控 |
| **BASH_CLASSIFIER** | Bash 分类器 | 权限控制 |

#### 记忆和存储 Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **TEAMMEM** | 团队记忆 | 团队共享记忆 |
| **UDS_INBOX** | UDS 收件箱 | 进程间通信 |
| **BUDDY** | 伙伴精灵 | 交互伴侣 |

#### 分析和遥测 Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **TRANSCRIPT_CLASSIFIER** | 转录分类器 | 自动模式 |
| **ENHANCED_TELEMETRY_BETA** | 增强遥测 | 数据分析 |
| **PERFETTO_TRACING** | Perfetto 追踪 | 性能分析 |
| **UPLOAD_USER_SETTINGS** | 上传用户设置 | 设置同步 |

#### 其他 Flag

| Flag 名称 | 功能描述 | 使用场景 |
|---------|---------|---------|
| **ULTRAPLAN** | 超级计划 | 计划模式 |
| **TORCH** | Torch 工具 | 调试 |
| **LODESTONE** | Lodestone | 会话恢复 |
| **MCP_SKILLS** | MCP 技能 | 技能集成 |
| **EXPERIMENTAL_SKILL_SEARCH** | 实验性技能搜索 | 技能发现 |
| **CHICAGO_MCP** | Chicago MCP | 计算机使用 |
| **BG_SESSIONS** | 后台会话 | 会话管理 |
| **COMMIT_ATTRIBUTION** | 提交归因 | Git 归因 |
| **HARD_FAIL** | 硬失败 | 错误处理 |

### 4.3 Feature Flag 使用示例

```typescript
// 条件导入
const proactiveModule = feature('PROACTIVE') || feature('KAIROS')
  ? require('../../proactive/index.js')
  : null;

// 条件代码执行
if (feature('KAIROS')) {
  // 启用 KAIROS 功能
}

// 工具条件启用
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null;

// 命令条件注册
const voiceCommand = feature('VOICE_MODE')
  ? require('./commands/voice/index.js').default
  : null;
```

---

## 五、记忆系统实现

### 5.1 记忆系统架构

记忆系统用于存储和检索用户、项目相关的持久化信息，帮助 AI 更好地理解上下文。

#### 核心文件
- `src/utils/memory/types.ts` - 记忆类型定义
- `src/utils/memory/versions.ts` - 版本管理
- `src/memdir/memoryTypes.ts` - 记忆类型分类
- `src/memdir/memdir.ts` - 记忆目录管理
- `src/memdir/memoryScan.ts` - 记忆扫描

### 5.2 记忆类型分类

```typescript
// 记忆类型值
export const MEMORY_TYPE_VALUES = [
  'User',
  'Project', 
  'Local',
  'Managed',
  'AutoMem',
  ...(feature('TEAMMEM') ? (['TeamMem'] as const) : []),
] as const;

export type MemoryType = (typeof MEMORY_TYPE_VALUES)[number];
```

#### 详细记忆类型

```typescript
export const MEMORY_TYPES = [
  'user',       // 用户信息
  'feedback',   // 反馈信息
  'project',    // 项目信息
  'reference',  // 参考信息
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
```

### 5.3 记忆类型详细说明

#### 1. User（用户记忆）

**作用范围**: 始终私有

**存储内容**:
- 用户的角色、目标、职责
- 用户的知识背景和技能
- 用户的偏好和习惯

**何时保存**:
- 了解用户的角色时
- 了解用户的偏好时
- 了解用户的知识背景时

**使用方式**:
```
示例:
用户: "I'm a data scientist investigating what logging we have in place"
AI: [保存用户记忆: 用户是数据科学家，专注于可观测性/日志]
```

#### 2. Feedback（反馈记忆）

**作用范围**: 默认私有，项目级约定可设为团队

**存储内容**:
- 用户对 AI 行为的纠正
- 用户对 AI 行为的确认
- 工作方式的指导

**何时保存**:
- 用户纠正 AI 时 ("no not that", "don't", "stop doing X")
- 用户确认有效方法时 ("yes exactly", "perfect")

**结构要求**:
```markdown
规则本身
**Why:** 用户给出的原因
**How to apply:** 何时/何地应用
```

**使用方式**:
```
示例:
用户: "don't mock the database in these tests — we got burned last quarter"
AI: [保存反馈记忆: 集成测试必须连接真实数据库，不能 mock]
```

#### 3. Project（项目记忆）

**作用范围**: 私有或团队，倾向于团队

**存储内容**:
- 正在进行的工作
- 项目目标和计划
- 已知问题和事件
- 截止日期和约束

**何时保存**:
- 了解谁在做什么、为什么、何时完成
- 将相对日期转换为绝对日期保存

**结构要求**:
```markdown
事实或决策
**Why:** 动机（约束、截止日期、利益相关者要求）
**How to apply:** 如何影响建议
```

**使用方式**:
```
示例:
用户: "we're freezing all non-critical merges after Thursday"
AI: [保存项目记忆: 2026-03-05 开始合并冻结，标记非关键 PR]
```

#### 4. Reference（参考记忆）

**作用范围**: 通常是团队

**存储内容**:
- 外部系统资源指针
- 工具和资源位置
- 文档和仪表板链接

**何时保存**:
- 了解外部系统的资源时

**使用方式**:
```
示例:
用户: "check the Linear project 'INGEST' for pipeline bugs"
AI: [保存参考记忆: pipeline bugs 在 Linear 项目 "INGEST" 中跟踪]
```

### 5.4 记忆存储位置

```typescript
// 记忆目录结构
.claude/
├── memories/
│   ├── user/           # 用户级记忆
│   ├── project/        # 项目级记忆
│   ├── local/          # 本地记忆
│   └── team/           # 团队记忆 (TEAMMEM)
```

### 5.5 记忆文件格式

```markdown
---
name: {{memory name}}
description: {{one-line description}}
type: {{user, feedback, project, reference}}
---

{{memory content}}

**Why:** {{reason}}
**How to apply:** {{application guidance}}
```

### 5.6 记忆使用原则

#### 不应该保存的内容

1. **代码模式、约定、架构** - 可从当前项目状态推导
2. **Git 历史** - `git log` / `git blame` 是权威来源
3. **调试解决方案** - 修复已在代码中，提交消息有上下文
4. **已在 CLAUDE.md 中记录的内容**
5. **临时任务详情** - 进行中的工作、临时状态

#### 记忆漂移警告

```
记忆记录可能随时间变得陈旧。使用记忆作为某时间点为真的上下文。
在回答用户或基于记忆信息建立假设之前，验证记忆是否仍然正确和最新。
如果记忆与当前信息冲突，信任当前观察到的内容，并更新或删除陈旧记忆。
```

#### 验证记忆

```
在基于记忆推荐之前:
- 如果记忆提到文件路径: 检查文件是否存在
- 如果记忆提到函数或标志: grep 搜索它
- 如果用户即将根据推荐行动: 先验证

"记忆说 X 存在" 不等于 "X 现在存在"
```

### 5.7 记忆系统实现逻辑

```typescript
// 记忆扫描和加载
export async function scanMemories(
  cwd: string,
  options: ScanOptions
): Promise<Memory[]> {
  const memories: Memory[] = [];
  
  // 扫描用户记忆
  const userMemories = await scanUserMemories();
  memories.push(...userMemories);
  
  // 扫描项目记忆
  const projectMemories = await scanProjectMemories(cwd);
  memories.push(...projectMemories);
  
  // 扫描团队记忆（如果启用）
  if (feature('TEAMMEM')) {
    const teamMemories = await scanTeamMemories();
    memories.push(...teamMemories);
  }
  
  return memories;
}

// 记忆匹配和检索
export function findRelevantMemories(
  memories: Memory[],
  context: string
): Memory[] {
  return memories.filter(memory => {
    // 基于描述和内容的匹配
    const relevance = calculateRelevance(memory, context);
    return relevance > threshold;
  });
}
```

---

## 六、总结

### 6.1 Agent 工具总结

AgentTool 是 Claude Code 的核心功能，支持：
- **同步执行**: 实时返回结果
- **异步后台**: 长时间任务不阻塞
- **Fork 隔离**: 独立的 git worktree
- **远程执行**: 云端 CCR 环境
- **内置代理**: 6 种预定义代理类型

### 6.2 工具系统总结

- **40+ 工具**: 覆盖文件、命令、Web、任务等
- **统一接口**: 标准化的 Tool 类型定义
- **权限控制**: 细粒度的工具访问控制
- **条件启用**: Feature Flag 控制工具可用性

### 6.3 斜杠命令总结

- **50+ 命令**: 涵盖所有用户交互场景
- **三种类型**: Prompt、Local、LocalJSX
- **动态注册**: 支持插件和 MCP 命令
- **懒加载**: 条件导入优化启动性能

### 6.4 Feature Flag 总结

- **50+ Flag**: 控制各种功能特性
- **编译时优化**: Bun bundle 实现死代码消除
- **灵活配置**: 支持环境变量和 GrowthBook
- **渐进发布**: 便于功能测试和灰度发布

### 6.5 记忆系统总结

- **4 种类型**: User、Feedback、Project、Reference
- **作用范围**: 私有、团队、项目级
- **版本管理**: 支持记忆版本控制
- **智能检索**: 基于上下文的相关性匹配
- **漂移处理**: 自动检测和处理陈旧记忆

这些系统共同构成了 Claude Code 强大而灵活的 AI 编程助手功能，为用户提供了智能、安全、可扩展的开发体验。
