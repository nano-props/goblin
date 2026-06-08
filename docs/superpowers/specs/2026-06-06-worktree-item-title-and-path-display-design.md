# Worktree Item Title and Full Path Display Design

## 1. 目标
- 将 Worktree 列表项的标题从完整路径改为仅显示路径最后一段目录名。
- 在 Worktree 列表项中新增一行显示完整路径，格式为 `path: /full/path/to/worktree`。
- 保持现有的 `branch`、状态徽标（badges）、`Terminals` 与 `Remove` 按钮行为不变。
- 仅改动 Android 端仓库详情页（`WorktreeRow`）的展示逻辑。

## 2. 范围
- 仅修改：
  - `android/app/src/main/java/dev/goblin/android/ui/screens/repositories/RepositorySetupScreen.kt`
- 不新增后端接口，不改 `RemoteRepositoryWorktree` 数据模型，不更改服务层与存储。

## 3. 设计方案（已批准：方案1）
### 3.1 标题与路径显示
- 在 `WorktreeRow` 中新增局部派生变量：
  - `worktreeTitle = worktree.path.trim().trimEnd('/').substringAfterLast('/', missingDelimiterValue = worktree.path).ifBlank { worktree.path }`
- 使用 `worktreeTitle` 作为第一行主标题。
- 新增第二行副标题（bodySmall）：
  - `Text("path: ${worktree.path}")`

### 3.2 兼容性与回退
- `worktree.path` 为空或末尾只有斜杠时，`worktreeTitle` 回退到原始 `worktree.path`。
- 因为数据来源来自已有快照，若 `worktree.path` 已存在，逻辑不会引入额外网络或状态依赖。

### 3.3 交互不变
- `Terminals` 按钮仍触发 `onSelectTerminalWorkspace(worktreeTerminalPath(worktree))`。
- `Remove` 按钮保留既有安全策略控制（`removalSafety.allowed`），文案与行为不变。

## 4. 实施变更点（预期）
- 在 `WorktreeRow`：
  - 新增标题字符串计算。
  - 调整首列文本顺序：
    1. `worktreeTitle`
    2. `path: ...`
    3. 分支
    4. badge 列表
- 保持 `Row`/`Column` 排版与右对齐按钮风格不变（与当前 UI 约束一致）。

## 5. 风险与回归
- 低：仅纯展示层字符串变更，逻辑分支有限。
- 与主标题空间变化相关的视觉调整已归入现有布局中现有 `singleLine`/溢出策略处理，不影响点击行为。

## 6. 验收标准
- Worktree 条目首行显示短名（路径最后一段）。
- 同一条目包含 `path: full_dir_path` 一行。
- `Terminals` 与 `Remove` 的可见性/点击行为与当前版本一致。
- 不影响 branch/worktree 列表刷新与条目点击逻辑。

## 7. 自检清单
- 不包含 TODO/TBD。
- 术语一致：`path` 使用小写前缀。
- 单一设计范围：仅覆盖 Worktree 条目标题与副标题显示。
- 与已批准方向一致：方案1（UI 内部解析显示名）。
