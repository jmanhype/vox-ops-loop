# VoxYZ Ops-Loop Integration Guides

## 📋 Overview

This document provides comprehensive integration guides for all executor types in the Ops-Loop system. Executors are the bridge between mission steps and external systems, enabling autonomous agents to interact with the world through controlled, policy-gated interfaces.

**What is an Executor?**

An executor is a pluggable component that:
- Accepts a mission step with parameters
- Executes a specific action against an external system
- Returns a standardized result (`{ ok: true/false, ... }`)
- Enforces security policies and constraints
- Handles errors and timeouts appropriately

**Executor Architecture:**

```
Mission Step → Executor Registry → Specific Executor → External System → Result
```

## 🎯 Executor System

### Executor Registry

All executors are registered in `/ops-loop/local/src/executors/index.mjs`:

```javascript
import { runWreckit } from './wreckit.mjs';
import { runOpenClaw } from './openclaw.mjs';
import { runRadar } from './radar.mjs';
import { runMinion } from './minion.mjs';

export async function executeStep(step) {
  const executor = step.executor || 'openclaw';

  if (step.kind === 'minion' || step.kind === 'minion_request') {
    return await runMinion(step);
  }

  if (step.kind === 'radar') {
    return await runRadar(step);
  }

  if (executor === 'openclaw' || step.kind === 'openclaw') {
    return await runOpenClaw(step);
  }

  if (executor === 'wreckit' || step.kind === 'wreckit') {
    return await runWreckit(step);
  }

  if (executor === 'noop') {
    return { ok: true, note: 'noop executor' };
  }

  throw new Error(`No executor registered for ${executor}`);
}
```

### Executor Resolution Order

1. **Kind-based routing**: `step.kind` checked first for `minion`, `radar`
2. **Executor-based routing**: `step.executor` used for `openclaw`, `wreckit`, `noop`
3. **Default fallback**: `openclaw` if no executor specified

### Standard Step Schema

All executors accept steps with this structure:

```json
{
  "kind": "step_type",
  "executor": "executor_name",
  "params": {
    // Executor-specific parameters
  }
}
```

### Standard Result Schema

All executors return results following this pattern:

**Success:**
```json
{
  "ok": true,
  "stdout": "command output",
  "stderr": "error output",
  // Additional executor-specific fields
}
```

**Failure:**
```json
{
  "ok": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "stdout": "partial output",
  "stderr": "error output"
}
```

---

## 🔧 OpenClaw Executor

### Overview

OpenClaw is the primary AI agent executor, enabling sophisticated autonomous agents to reason about problems, use tools, and generate structured outputs. It's built for complex cognitive tasks requiring multi-step reasoning.

**Use Cases:**
- Content creation (writing, analysis, summarization)
- Code review and generation
- Research and investigation
- Decision support and planning
- Multi-modal interactions (text, files, browsing)

### Configuration

#### Required Parameters

```json
{
  "kind": "openclaw",
  "executor": "openclaw",
  "params": {
    "subcommand": "agent",
    "agent": "editor",
    "prompt": "Your task description"
  }
}
```

#### Optional Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `subcommand` | string | OpenClaw subcommand to run | `"agent"` |
| `agent` | string | Agent role to use | Required |
| `prompt` or `message` | string | Task description | Required |
| `thinking` | string | Thinking verbosity: `"low"`, `"medium"`, `"high"` | None |
| `tools` | array<string> | Tools to allow (policy-gated) | None |
| `cwd` | string | Working directory | Current directory |
| `args` | array<string> | Additional CLI flags | [] |
| `timeout_ms` | number | Execution timeout | 600000 (10 min) |
| `session_id` | string | Session identifier | None |
| `deliver` | boolean | Enable delivery mode | false |
| `reply_channel` | string | Reply channel | None |
| `reply_to` | string | Reply target | None |
| `local` | boolean | Local execution flag | false |

### Policy Controls

#### Allowed Subcommands

Control which OpenClaw subcommands can be executed via `worker_policy.allowed_openclaw_subcommands`:

```json
{
  "worker_policy": {
    "allowed_openclaw_subcommands": ["agent", "chat", "completion"]
  }
}
```

**Default**: `["agent"]`

**Available Subcommands:**
- `agent` - Full agent mode with tools (default)
- `chat` - Simple chat interface
- `completion` - Single-turn completion

#### Tool Gating

Control which tools agents can access via `worker_policy.allowed_tools`:

```json
{
  "worker_policy": {
    "allowed_tools": ["browser", "files", "search", "git"]
  }
}
```

**Security**: Tools are validated against policy before execution. If an agent requests a tool not in the allowlist, the step fails with `Unauthorized tool requested: <tool>`.

#### Timeout Protection

Set maximum execution time:

```json
{
  "worker_policy": {
    "openclaw_timeout_ms": 300000
  }
}
```

Or per-step:
```json
{
  "params": {
    "timeout_ms": 120000
  }
}
```

**Default**: 10 minutes

**Behavior**: On timeout, process receives `SIGTERM`, step fails with code `TIMEOUT`.

### Usage Examples

#### Basic Agent Call

```json
{
  "kind": "openclaw",
  "executor": "openclaw",
  "params": {
    "agent": "editor",
    "prompt": "Summarize the latest changes in ARCHITECTURE.md"
  }
}
```

#### Agent with Tools

```json
{
  "kind": "openclaw",
  "executor": "openclaw",
  "params": {
    "agent": "researcher",
    "prompt": "Research the latest React documentation and summarize key changes",
    "thinking": "high",
    "tools": ["browser", "search"],
    "cwd": "/Users/speed/projects/docs"
  }
}
```

#### Content Generation

```json
{
  "kind": "draft_blog_post",
  "executor": "openclaw",
  "params": {
    "agent": "writer",
    "prompt": "Write a 500-word blog post about serverless architecture",
    "thinking": "medium",
    "args": ["--deliver"]
  }
}
```

#### Code Review

```json
{
  "kind": "code_review",
  "executor": "openclaw",
  "params": {
    "agent": "reviewer",
    "prompt": "Review the changes in PR #42 for security issues",
    "thinking": "high",
    "tools": ["files", "git"]
  }
}
```

#### Multi-Step Analysis

```json
{
  "kind": "openclaw",
  "executor": "openclaw",
  "params": {
    "agent": "analyst",
    "prompt": "Analyze the performance metrics and identify bottlenecks",
    "thinking": "high",
    "session_id": "perf-analysis-2025-01-21"
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCLAW_BIN` | Path to openclaw binary | `"openclaw"` |
| `OPENCLAW_TIMEOUT_MS` | Default timeout | 600000 |

### Argument Sanitization

The executor enforces strict validation:
- **Null bytes rejected**: Prevents string injection attacks
- **Argument length limit**: 512 chars per argument
- **Total size limit**: 4096 chars total
- **Shell escaping**: Arguments passed as array, no shell interpretation

### Error Handling

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `TIMEOUT` | Execution exceeded timeout | Increase `timeout_ms` or simplify task |
| `Unauthorized tool` | Tool not in allowlist | Add tool to `worker_policy.allowed_tools` |
| `subcommand not allowed` | Subcommand not in allowlist | Add to `worker_policy.allowed_openclaw_subcommands` |
| `Argument too long` | Argument exceeds 512 chars | Shorten argument |
| `Arguments too large` | Total args exceed 4096 chars | Reduce number of arguments |
| Non-zero exit code | OpenClaw execution failed | Check `stderr` for details |

### Troubleshooting

#### Issue: "Unauthorized tool requested"

**Cause**: Agent requested a tool not in the allowlist.

**Solution**:
1. Check policy: `SELECT value->'worker_policy'->'allowed_tools' FROM ops_policy;`
2. Add missing tool to policy
3. Or remove tool requirement from agent prompt

#### Issue: "OpenClaw command timed out"

**Cause**: Task took longer than timeout.

**Solution**:
1. Increase timeout in policy or per-step
2. Simplify the task
3. Check if agent is stuck in a loop

#### Issue: "subcommand not allowed"

**Cause**: Subcommand not in policy allowlist.

**Solution**:
1. Verify subcommand is needed
2. Add to `worker_policy.allowed_openclaw_subcommands`
3. Use default `"agent"` subcommand instead

#### Issue: High memory usage

**Cause**: Long-running agent with extensive context.

**Solution**:
1. Use `session_id` to maintain state across shorter calls
2. Reduce `thinking` level
3. Break into smaller tasks

---

## 🔨 Wreckit Executor

### Overview

Wreckit is the software development lifecycle (SDLC) automation executor, enabling autonomous agents to manage PRDs, implement features, run tests, and manage deployments through a unified CLI interface.

**Use Cases:**
- PRD management (status, ideas, research)
- Feature implementation and coding
- Testing and validation
- Code review and PR management
- Deployment automation

### Configuration

#### Required Parameters

```json
{
  "kind": "wreckit",
  "executor": "wreckit",
  "params": {
    "command": "implement",
    "id": "item-id"
  }
}
```

#### Optional Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `command` | string | Wreckit command (see list below) | Required |
| `id` | string | Item/PRD identifier | Required for most commands |
| `cwd` | string | Working directory | Current directory |
| `parallel` | string/number | Parallel execution count | None |
| `verbose` | boolean | Enable verbose output | true (auto-enabled) |
| `dry_run` | boolean | Preview without execution | false |
| `max_items` | number | Maximum items to process | None |
| `force` | boolean | Force operation | false |

### Allowed Commands

Only these Wreckit commands are permitted:

| Command | Description | Requires ID |
|---------|-------------|-------------|
| `status` | Show system status | No |
| `list` | List all items | No |
| `show` | Show item details | Yes |
| `run` | Run workflow for item | Yes |
| `next` | Execute next pending story | No |
| `ideas` | Generate ideas from input | No |
| `doctor` | Diagnose system health | No |
| `rollback` | Rollback item changes | Yes |
| `init` | Initialize new item | No |
| `research` | Research phase for item | Yes |
| `plan` | Planning phase for item | Yes |
| `implement` | Implementation phase | Yes |
| `pr` | Create pull request | Yes |
| `complete` | Mark item complete | Yes |

**Security**: Commands not in this list will fail with `Invalid or missing Wreckit command`.

### Usage Examples

#### Implement a Feature

```json
{
  "kind": "wreckit",
  "executor": "wreckit",
  "params": {
    "command": "implement",
    "id": "123-feature-authentication",
    "cwd": "/Users/speed/workspace",
    "verbose": true
  }
}
```

#### Generate Ideas

```json
{
  "kind": "wreckit",
  "executor": "wreckit",
  "params": {
    "command": "ideas",
    "cwd": "/Users/speed/workspace",
    "max_items": 10
  }
}
```

#### Research Phase

```json
{
  "kind": "wreckit_research",
  "executor": "wreckit",
  "params": {
    "command": "research",
    "id": "456-api-redesign",
    "verbose": true
  }
}
```

#### Run Complete Workflow

```json
{
  "kind": "wreckit_workflow",
  "executor": "wreckit",
  "params": {
    "command": "run",
    "id": "789-bug-fix",
    "parallel": "3"
  }
}
```

#### Create Pull Request

```json
{
  "kind": "wreckit_pr",
  "executor": "wreckit",
  "params": {
    "command": "pr",
    "id": "101-feature-flags"
  }
}
```

#### System Health Check

```json
{
  "kind": "wreckit_doctor",
  "executor": "wreckit",
  "params": {
    "command": "doctor"
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_BIN` | Path to Node.js binary | `"node"` |
| `WRECKIT_WRAPPER` | Path to Wreckit wrapper script | `/Users/speed/.openclaw/workspace/wreckit/scripts/run-wreckit.mjs` |

### Execution Behavior

**Live Streaming**: Output is streamed to stdout/stderr in real-time for observability.

**Verbose Mode**: Automatically enabled in autonomous mode to provide full execution context.

**Working Directory**: Respects `params.cwd` for all operations.

### Error Handling

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `Invalid Wreckit command` | Command not in allowlist | Use only permitted commands |
| Non-zero exit | Wreckit execution failed | Check output for specific error |
| `ENOENT` | Wrapper script not found | Check `WRECKIT_WRAPPER` env var |

### Troubleshooting

#### Issue: "Invalid or missing Wreckit command"

**Cause**: Command not in the allowed set.

**Solution**:
1. Verify command is in the allowed list
2. Check for typos in command name
3. Use `list` command to see available items

#### Issue: Wreckit exits with error code

**Cause**: Underlying Wreckit script failed.

**Solution**:
1. Check `stderr` for specific error details
2. Run `doctor` command to diagnose system
3. Verify `id` parameter is correct
4. Check working directory is valid

#### Issue: No output visible

**Cause**: Verbose mode might be disabled.

**Solution**:
1. Ensure `verbose: true` in params
2. Check if command is long-running
3. Verify Wreckit wrapper script is executable

#### Issue: "Cannot find wrapper script"

**Cause**: `WRECKIT_WRAPPER` path is incorrect.

**Solution**:
1. Set correct path in environment
2. Use absolute path
3. Verify script exists and is executable

---

## 📡 Radar Executor

### Overview

Radar is the product roadmap and demand tracking executor, enabling autonomous agents to manage feature requests, ideas, and product initiatives through a 4-stage lifecycle (Watching → Validating → Building → Shipped).

**Use Cases:**
- Track feature requests and ideas
- Manage product discovery workflow
- Maintain product roadmap
- Coordinate across teams
- Track demand metrics

### Configuration

#### Required Parameters

```json
{
  "kind": "radar",
  "executor": "radar",
  "params": {
    "action": "add"
  }
}
```

#### Actions

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `add` | Add new item to radar | `title`, `description` |
| `update` | Update item stage | `id` or `title`, `stage` |
| `list` | List items by stage | `stage` (optional) |

### Usage Examples

#### Add to Radar

```json
{
  "kind": "radar",
  "executor": "radar",
  "params": {
    "action": "add",
    "params": {
      "title": "Real-time collaboration features",
      "description": "Add WebSocket-based real-time editing",
      "stage": "watching"
    }
  }
}
```

#### Update Stage

```json
{
  "kind": "radar_update",
  "executor": "radar",
  "params": {
    "action": "update",
    "params": {
      "title": "Real-time collaboration features",
      "stage": "validating",
      "notes": "Market research shows high demand"
    }
  }
}
```

#### List by Stage

```json
{
  "kind": "radar_list",
  "executor": "radar",
  "params": {
    "action": "list",
    "params": {
      "stage": "building"
    }
  }
}
```

#### Full Workflow Example

```json
{
  "title": "Add feature to radar and validate",
  "risk_level": "low",
  "steps": [
    {
      "kind": "radar",
      "executor": "radar",
      "params": {
        "action": "add",
        "params": {
          "title": "API rate limiting",
          "description": "Implement configurable rate limiting for API endpoints"
        }
      }
    },
    {
      "kind": "openclaw",
      "executor": "openclaw",
      "params": {
        "agent": "analyst",
        "prompt": "Research rate limiting best practices and validate this feature request"
      }
    },
    {
      "kind": "radar",
      "executor": "radar",
      "params": {
        "action": "update",
        "params": {
          "title": "API rate limiting",
          "stage": "validating"
        }
      }
    }
  ]
}
```

### Data Schema

Radar items are stored in the `ops_radar` table:

```sql
CREATE TABLE ops_radar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('watching', 'validating', 'building', 'shipped')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Stage Lifecycle

```
┌──────────┐     ┌─────────────┐     ┌──────────┐     ┌─────────┐
│ Watching │ ──> │ Validating  │ ──> │ Building │ ──> │ Shipped │
└──────────┘     └─────────────┘     └──────────┘     └─────────┘
     ^                                   │
     │                                   │
     └───────────────────────────────────┘
              (feedback loop)
```

### Error Handling

| Error | Description | Resolution |
|-------|-------------|------------|
| `Unknown radar action` | Action not `add`, `update`, or `list` | Use valid action |
| `Missing id or title` | Update requires identifier | Provide `id` or `title` |
| Database error | Supabase insert/update failed | Check data types and constraints |

### Troubleshooting

#### Issue: "Unknown radar action"

**Cause**: Invalid action specified.

**Solution**:
1. Use only `add`, `update`, or `list`
2. Check action name spelling
3. Verify action is lowercase

#### Issue: "Missing id or title for updateRadarStage"

**Cause**: Update action requires identifier.

**Solution**:
1. Provide either `id` (UUID) or `title` (exact match)
2. Use `list` action to find correct title
3. Check for typos in title

#### Issue: Stage constraint violation

**Cause**: Invalid stage name.

**Solution**:
1. Use only valid stages: `watching`, `validating`, `building`, `shipped`
2. Check stage name spelling
3. Ensure stage is lowercase

---

## 🤖 Minion Executor

### Overview

Minion is the general-purpose task executor, combining Wreckit SDLC automation with safe shell command execution. It serves as the "builder" role, capable of running development commands, shell operations, and coordinating workflows.

**Use Cases:**
- Run Wreckit commands seamlessly
- Execute safe shell commands (git, npm, etc.)
- Coordinate development workflows
- Run build and test scripts
- File system operations

### Configuration

#### Required Parameters

```json
{
  "kind": "minion",
  "executor": "minion",
  "params": {
    "command": "command_name"
  }
}
```

#### Command Routing

Minion intelligently routes commands:

1. **Wreckit Commands**: If `command` is a Wreckit command, delegates to Wreckit executor
2. **Shell Commands**: If command is in allowed shell list, executes safely
3. **Special Handling**: `ideas` command with string parameter gets special treatment

### Allowed Shell Commands

Only these shell commands are permitted:

| Command | Purpose | Example |
|---------|---------|---------|
| `git` | Version control | `["status", "log", "commit"]` |
| `vercel` | Deployment | `["deploy", "--prod"]` |
| `npm` | Package management | `["install", "test"]` |
| `echo` | Output | `["Build complete"]` |
| `mkdir` | Create directory | `["-p", "dist"]` |
| `ls` | List files | `["-la"]` |
| `cat` | Read file | `["package.json"]` |
| `touch` | Create file | `[".gitkeep"]` |
| `rm` | Remove file | `["-rf", "node_modules"]` |
| `sh` | Shell script | `["-c", "script.sh"]` |
| `node` | Node.js | `["script.js"]` |
| `bun` | Bun runtime | `["run", "app.tsx"]` |

**Security**: Commands not in this list will fail with `Minion shell fallback is not allowed to run: <command>`.

### Usage Examples

#### Wreckit Command (Auto-routed)

```json
{
  "kind": "minion",
  "executor": "minion",
  "params": {
    "command": "implement",
    "id": "123-feature",
    "cwd": "/Users/speed/workspace"
  }
}
```

#### Git Status

```json
{
  "kind": "minion",
  "executor": "minion",
  "params": {
    "command": "git",
    "args": ["status", "--short"],
    "cwd": "/Users/speed/project"
  }
}
```

#### NPM Install

```json
{
  "kind": "minion",
  "executor": "minion",
  "params": {
    "command": "npm",
    "args": ["install", "--silent"],
    "cwd": "/Users/speed/project"
  }
}
```

#### Build Command

```json
{
  "kind": "minion_build",
  "executor": "minion",
  "params": {
    "command": "npm",
    "args": ["run", "build"],
    "cwd": "/Users/speed/project"
  }
}
```

#### Vercel Deploy

```json
{
  "kind": "minion_deploy",
  "executor": "minion",
  "params": {
    "command": "vercel",
    "args": ["deploy", "--prod"],
    "cwd": "/Users/speed/project"
  }
}
```

#### Ideas with Content (Special Handling)

```json
{
  "kind": "minion",
  "executor": "minion",
  "params": {
    "command": "ideas",
    "idea": "Build a real-time collaboration feature using WebSockets",
    "cwd": "/Users/speed/workspace"
  }
}
```

#### Create Directory

```json
{
  "kind": "minion",
  "executor": "minion",
  "params": {
    "command": "mkdir",
    "args": ["-p", "dist/assets"],
    "cwd": "/Users/speed/project"
  }
}
```

### Environment Variables

Minion passes these environment variables to shell commands:

| Variable | Source |
|----------|--------|
| `ANTHROPIC_API_KEY` | `ZAI_API_KEY` or `OPENAI_API_KEY` |
| `ANTHROPIC_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` |
| `ZAI_API_KEY` | Process environment |
| `OPENAI_API_KEY` | Process environment |

**Security**: API keys are proxied through environment variables, never in command arguments.

### Execution Behavior

**Wreckit Routing**: Automatically detects Wreckit commands and routes appropriately.

**Live Streaming**: Output captured and returned in result (not live-streamed like Wreckit executor).

**Working Directory**: Respects `params.cwd`; defaults to current directory.

**Error Handling**: Non-zero exit codes result in rejection with error details.

### Special Handling for Ideas

When `command` is `"ideas"` and an `idea` parameter is provided:
1. Idea content written to temporary file: `/tmp/wreckit-idea-{timestamp}.md`
2. Executed via Bun with `--file` flag pointing to temp file
3. Temp file cleaned up after execution

**Purpose**: Enables piping multi-line idea content into Wreckit.

### Error Handling

| Error | Description | Resolution |
|-------|-------------|------------|
| `Minion step requires a "command" parameter` | No command specified | Add `params.command` |
| `shell fallback is not allowed` | Command not in allowlist | Use only allowed commands |
| Non-zero exit | Command execution failed | Check `stderr` for details |

### Troubleshooting

#### Issue: "Minion step requires a command parameter"

**Cause**: No `command` provided in params.

**Solution**:
1. Add `"command": "command_name"` to params
2. Verify command name spelling
3. Check if command should be Wreckit or shell

#### Issue: "shell fallback is not allowed to run"

**Cause**: Command not in allowed shell commands list.

**Solution**:
1. Verify command is in allowed list
2. Use Wreckit executor if appropriate
3. Request command be added to allowlist (requires code change)

#### Issue: Command fails silently

**Cause**: Error output not captured.

**Solution**:
1. Check `stderr` field in result
2. Verify working directory is correct
3. Ensure all required files exist
4. Check command syntax

#### Issue: Git command fails

**Cause**: Git repository not initialized or wrong directory.

**Solution**:
1. Verify `cwd` points to git repository
2. Check git is installed and accessible
3. Ensure proper permissions

#### Issue: Ideas command not using provided content

**Cause**: Ideas parameter might be ignored if command routing fails.

**Solution**:
1. Verify `command` is `"ideas"`
2. Ensure `idea` parameter is provided
3. Check temp directory is writable

---

## 🔄 Noop Executor

### Overview

The Noop (no-operation) executor is a testing and dry-run utility that does nothing but return success. It's useful for testing proposal flows, validating templates, and simulating execution without side effects.

**Use Cases:**
- Testing proposal creation
- Validating reaction matrix patterns
- Dry-run mission execution
- Integration testing without side effects
- Performance testing (baseline executor overhead)

### Configuration

```json
{
  "kind": "noop",
  "executor": "noop",
  "params": {}
}
```

All parameters are ignored. The executor simply returns:

```json
{
  "ok": true,
  "note": "noop executor"
}
```

### Usage Examples

#### Test Proposal Flow

```json
{
  "title": "Test proposal creation",
  "risk_level": "low",
  "steps": [
    {
      "kind": "noop",
      "executor": "noop",
      "params": {}
    }
  ]
}
```

#### Dry-Run Complex Workflow

```json
{
  "title": "Validate workflow without execution",
  "risk_level": "none",
  "steps": [
    { "kind": "noop", "executor": "noop", "params": {} },
    { "kind": "noop", "executor": "noop", "params": {} },
    { "kind": "noop", "executor": "noop", "params": {} }
  ]
}
```

#### Integration Testing

```json
{
  "title": "Test multi-agent coordination",
  "risk_level": "low",
  "steps": [
    {
      "kind": "noop",
      "executor": "noop",
      "params": { "agent": "scout" }
    },
    {
      "kind": "noop",
      "executor": "noop",
      "params": { "agent": "sage" }
    },
    {
      "kind": "noop",
      "executor": "noop",
      "params": { "agent": "quill" }
    }
  ]
}
```

### Behavior

- **Always succeeds**: Never throws errors
- **No side effects**: No external system calls
- **No timeout**: Returns immediately
- **No policy checks**: Bypasses all policy validation
- **No logging**: Minimal output

### Error Handling

None. The noop executor never fails.

### Troubleshooting

No troubleshooting needed. If noop executor fails, there's a bug in the executor registry.

---

## 🛠️ Custom Executor Development

### Executor Interface

All executors must implement this interface:

```javascript
/**
 * Execute a mission step
 * @param {Object} step - The step to execute
 * @param {string} step.kind - Step kind/type
 * @param {string} step.executor - Executor name
 * @param {Object} step.params - Executor-specific parameters
 * @returns {Promise<Object>} Result object
 * @returns {boolean} result.ok - Success indicator
 * @returns {string} [result.stdout] - Standard output
 * @returns {string} [result.stderr] - Error output
 * @returns {*} [result.*] - Additional fields
 */
export async function executeStep(step) {
  // Implementation
}
```

### Creating a New Executor

#### Step 1: Create Executor File

Create `/ops-loop/local/src/executors/myexecutor.mjs`:

```javascript
import { spawn } from 'child_process';

export async function runMyExecutor(step) {
  const params = step.params || {};

  // Validate required parameters
  if (!params.requiredParam) {
    throw new Error('myexecutor requires requiredParam');
  }

  // Execute the task
  const result = await doSomething(params);

  // Return standardized result
  return {
    ok: true,
    output: result.data,
    metadata: result.meta
  };
}

async function doSomething(params) {
  // Your implementation here
  return { data: 'success', meta: {} };
}
```

#### Step 2: Register in Executor Index

Edit `/ops-loop/local/src/executors/index.mjs`:

```javascript
import { runMyExecutor } from './myexecutor.mjs';

export async function executeStep(step) {
  // ... existing executors ...

  if (executor === 'myexecutor' || step.kind === 'myexecutor') {
    return await runMyExecutor(step);
  }

  throw new Error(`No executor registered for ${executor}`);
}
```

#### Step 3: Test Executor

Create a test proposal:

```json
{
  "title": "Test custom executor",
  "risk_level": "low",
  "steps": [
    {
      "kind": "myexecutor",
      "executor": "myexecutor",
      "params": {
        "requiredParam": "value"
      }
    }
  ]
}
```

Insert into database:

```sql
SELECT ops_create_proposal_and_maybe_autoapprove(
  'Test custom executor',
  'low'::ops_risk_level,
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'myexecutor',
      'executor', 'myexecutor',
      'params', jsonb_build_object('requiredParam', 'value')
    )
  ),
  'test'
);
```

### Best Practices

#### 1. Parameter Validation

Always validate input parameters:

```javascript
if (!params.required) {
  throw new Error('required parameter missing');
}

if (typeof params.value !== 'string') {
  throw new Error('value must be a string');
}
```

#### 2. Security Hardening

Sanitize all external inputs:

```javascript
// Prevent injection attacks
if (params.input.includes('\u0000')) {
  throw new Error('Invalid input');
}

// Limit size
if (params.input.length > MAX_LENGTH) {
  throw new Error('Input too large');
}
```

#### 3. Timeout Protection

Always implement timeouts:

```javascript
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
}, TIMEOUT_MS);

// Clear timeout on completion
clearTimeout(timeout);
```

#### 4. Error Handling

Return structured errors:

```javascript
try {
  const result = await execute();
  return { ok: true, data: result };
} catch (error) {
  return {
    ok: false,
    error: error.message,
    code: error.code,
    stderr: error.stderr
  };
}
```

#### 5. Logging

Add useful logging:

```javascript
console.log(`[MyExecutor] Executing with params:`, JSON.stringify(params));
console.log(`[MyExecutor] Result:`, result.ok ? 'success' : 'failed');
```

#### 6. Policy Integration

Respect worker policy:

```javascript
import { getPolicyValue } from '../supabase.mjs';

const policy = await getPolicyValue('worker_policy', {});

// Check policy restrictions
if (policy.myexecutor_disabled) {
  throw new Error('myexecutor is disabled by policy');
}
```

#### 7. Idempotency

Make operations idempotent where possible:

```javascript
// Generate unique ID for idempotent operations
const id = params.id || generateId();

// Check if already executed
if (await isAlreadyExecuted(id)) {
  return { ok: true, note: 'already executed', id };
}
```

### Testing Custom Executors

#### Unit Testing

```javascript
import { runMyExecutor } from './myexecutor.mjs';

const result = await runMyExecutor({
  kind: 'myexecutor',
  executor: 'myexecutor',
  params: { requiredParam: 'test' }
});

console.assert(result.ok === true);
console.assert(result.output === 'success');
```

#### Integration Testing

```bash
# Create test proposal
psql -h db.nnmgddhlqfumlstopqxs.supabase.co \
  -U postgres \
  -d postgres \
  -f test_myexecutor.sql

# Run worker
cd /Users/speed/.openclaw/workspace/ops-loop/local
npm run worker

# Check results
psql -h db.nnmgddhlqfumlstopqxs.supabase.co \
  -U postgres \
  -d postgres \
  -c "SELECT * FROM ops_mission_steps WHERE kind = 'myexecutor' ORDER BY created_at DESC LIMIT 5;"
```

#### Error Testing

```javascript
// Test missing required parameter
try {
  await runMyExecutor({
    kind: 'myexecutor',
    executor: 'myexecutor',
    params: {}
  });
  console.error('Should have thrown error');
} catch (error) {
  console.log('Correctly threw:', error.message);
}
```

---

## 🧪 Integration Testing

### Testing Executor Integration

#### Test 1: Executor Registry

```javascript
import { executeStep } from './executors/index.mjs';

// Test noop executor
const result1 = await executeStep({
  kind: 'noop',
  executor: 'noop',
  params: {}
});
console.assert(result1.ok === true);

// Test unknown executor
try {
  await executeStep({
    kind: 'unknown',
    executor: 'unknown',
    params: {}
  });
  console.error('Should have thrown error');
} catch (error) {
  console.log('Correctly threw:', error.message);
}
```

#### Test 2: OpenClaw Integration

```javascript
const step = {
  kind: 'openclaw',
  executor: 'openclaw',
  params: {
    agent: 'editor',
    prompt: 'Say hello'
  }
};

const result = await executeStep(step);
console.log('OpenClaw result:', result);
```

#### Test 3: Wreckit Integration

```javascript
const step = {
  kind: 'wreckit',
  executor: 'wreckit',
  params: {
    command': 'status'
  }
};

const result = await executeStep(step);
console.log('Wreckit result:', result);
```

#### Test 4: Radar Integration

```javascript
const step = {
  kind: 'radar',
  executor: 'radar',
  params: {
    action: 'add',
    params: {
      title: 'Test item',
      description: 'Integration test'
    }
  }
};

const result = await executeStep(step);
console.log('Radar result:', result);
```

### Mocking Executor Responses

For testing without external dependencies:

```javascript
// Mock executor
export async function runMockExecutor(step) {
  return {
    ok: true,
    mocked: true,
    input: step.params
  };
}

// Use in tests
const originalExecutor = executeStep;
executeStep = async (step) => {
  if (step.executor === 'mock') {
    return await runMockExecutor(step);
  }
  return await originalExecutor(step);
};
```

### End-to-End Testing

```sql
-- Create test proposal
INSERT INTO ops_mission_proposals (
  title,
  risk_level,
  steps,
  source
) VALUES (
  'E2E Executor Test',
  'low',
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'noop',
      'executor', 'noop',
      'params', '{}'::jsonb
    ),
    jsonb_build_object(
      'kind', 'radar',
      'executor', 'radar',
      'params', jsonb_build_object(
        'action', 'add',
        'params', jsonb_build_object(
          'title', 'E2E Test Item',
          'description', 'Created by E2E test'
        )
      )
    )
  ),
  'e2e-test'
) RETURNING id;

-- Run worker
-- (from command line) npm run worker

-- Check results
SELECT
  mp.id,
  mp.title,
  m.status AS mission_status,
  COUNT(ms.id) AS total_steps,
  COUNT(*) FILTER (WHERE ms.status = 'completed') AS completed_steps
FROM ops_mission_proposals mp
LEFT JOIN ops_missions m ON m.proposal_id = mp.id
LEFT JOIN ops_mission_steps ms ON ms.mission_id = m.id
WHERE mp.source = 'e2e-test'
GROUP BY mp.id, m.status;
```

---

## 📚 Additional Resources

### Related Documentation

- [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - System architecture and data flow
- [Agent Guide](AGENT_GUIDE.md) - Agent roles and configurations
- [Policy Configuration](POLICY_CONFIGURATION.md) - Policy-based gating and controls
- [API Reference](API_REFERENCE.md) - Database schema and RPC functions

### Source Code

- **Executor Registry**: `/ops-loop/local/src/executors/index.mjs`
- **OpenClaw Executor**: `/ops-loop/local/src/executors/openclaw.mjs`
- **Wreckit Executor**: `/ops-loop/local/src/executors/wreckit.mjs`
- **Radar Executor**: `/ops-loop/local/src/executors/radar.mjs`
- **Minion Executor**: `/ops-loop/local/src/executors/minion.mjs`
- **Radar Skills**: `/ops-loop/local/src/skills/radar.mjs`

### External Systems

- **OpenClaw**: AI agent CLI tool
- **Wreckit**: SDLC automation system
- **Radar**: Product roadmap tracking (via `ops_radar` table)

### Support

For integration issues:
1. Check this guide's troubleshooting sections
2. Review executor source code for implementation details
3. Enable verbose logging in worker
4. Check database logs for errors
5. Review policy configuration in `ops_policy` table

---

**Version**: 1.0.0  
**Last Updated**: 2025-01-21  
**Maintainer**: VoxYZ Ops-Loop Team
