# 转场功能诊断指南

## 问题描述
用户报告生成的视频中没有看到转场视频穿插在片段之间。

## 已添加的诊断日志

### 1. 前端 - 文件选择时 (GeneratorPage.jsx)
**位置**: 默认转场视频选择按钮的 onClick 处理器

**日志内容**:
- `[默认转场选择文件] 点击按钮` - 确认按钮被点击
- `[默认转场选择文件] 当前 transitions` - 显示选择前的状态
- `[默认转场选择文件] 选择结果` - 文件选择对话框的结果
- `[默认转场选择文件] 选择的文件` - 实际选择的文件路径
- `[默认转场选择文件] 更新前/后 transitions` - 状态更新前后的对比

**检查点**:
- 确认 `result.filePaths[0]` 有值
- 确认 `defaultTransition` 被正确设置为新路径
- 确认 `setTransitions` 被调用

### 2. 前端 - 复选框切换时 (GeneratorPage.jsx)
**位置**: "启用转场" 复选框的 onChange 处理器

**日志内容**:
- `[GeneratorPage] 转场复选框变化: true/false` - 复选框的新状态
- `[GeneratorPage] 更新前 transitions` - 复选框切换前的完整状态
- `[GeneratorPage] 更新后 transitions` - 复选框切换后的完整状态

**检查点**:
- 确认 `e.target.checked` 为 `true` (已启用)
- 确认 `enabled` 字段被正确更新

### 3. 前端 - 构建发送数据时 (useGenerator.js)
**位置**: `runGenerator` 函数中的 payload 构建部分

**日志内容**:
- `[useGenerator] 准备调用 generator.run`
- `[useGenerator] payload.transitions` - 完整的 transitions 对象
- `[useGenerator] payload.transitions.enabled` - 启用状态
- `[useGenerator] payload.transitions.defaultTransition` - 默认转场路径
- `[useGenerator] payload.transitions.tagTransitionGroups` - 标签组数组
- `[useGenerator] 完整 payload` - 完整的请求数据

**检查点**:
- 确认 `transitions.enabled` 为 `true`
- 确认 `transitions.defaultTransition` 不为 `null` 或 `undefined`
- 确认 `transitions.defaultTransition` 是有效的文件路径
- 确认 payload 结构正确

### 4. 后端 - 接收数据时 (generator.cjs)
**位置**: `runGeneration` 函数开头

**日志内容**:
- `[runGeneration] 接收到的参数` - 所有参数的摘要
- `[runGeneration]   mode` - 输出模式
- `[runGeneration]   selection` - 片段数量
- `[runGeneration]   rules` - 拼接规则
- `[runGeneration]   output` - 输出设置
- `[runGeneration]   transitions` - 完整的 transitions 对象
- `[runGeneration]   transitions 类型` - 数据类型 (应该是 "object")
- `[runGeneration]   transitions.enabled` - 启用状态
- `[runGeneration]   transitions.defaultTransition` - 转场视频路径

**检查点**:
- 确认 transitions 对象存在 (不是 `undefined`)
- 确认 transitions.enabled 为 `true`
- 确认 transitions.defaultTransition 有值

### 5. 后端 - 转场配置诊断 (generator.cjs)
**位置**: 转场视频插入逻辑之前

**日志内容**:
```
========== 转场配置诊断 ==========
transitions 对象存在: true/false
transitions.enabled: true/false
transitions.defaultTransition: "路径" 或 '(未设置)'
transitions.tagTransitionGroups: [...]
====================================
```

**检查点**:
- 确认三个条件都满足:
  1. `transitions` 对象存在
  2. `transitions.enabled` 为 `true`
  3. `transitions.defaultTransition` 有值

### 6. 后端 - 转场未插入警告 (generator.cjs)
**位置**: 当转场插入条件不满足时

**日志内容**:
```
⚠️ 转场未插入 - 可能的原因:
  - transitions 对象不存在
  - 转场未启用 (transitions.enabled = false)
  - 未设置默认转场视频 (transitions.defaultTransition 为空)
继续使用原始 X 个片段进行拼接
```

**检查点**:
- 查看具体哪个条件未满足
- 根据提示的失败原因进行修复

## 诊断步骤

1. **重新启动应用** (确保新代码生效)
   ```bash
   npm run dev
   ```

2. **打开开发者工具控制台** (查看前端日志)

3. **操作流程**:
   - 在生成器页面勾选 "启用转场" 复选框
   - 点击 "选择文件" 按钮选择转场视频
   - 选择一些卡片
   - 点击 "开始生成" 按钮

4. **查看日志输出**:
   - **前端控制台** (浏览器 DevTools):
     - 查找 `[GeneratorPage]` 和 `[useGenerator]` 开头的日志
     - 确认 transitions 数据正确
   - **生成日志面板** (应用内):
     - 查找 `[runGeneration]` 开头的日志
     - 查找 "转场配置诊断" 部分
     - 查找转场插入成功/失败的消息

## 预期结果

### 如果一切正常:
```
[前端] [GeneratorPage] 转场复选框变化: true
[前端] [默认转场选择文件] 选择的文件: C:\path\to\transition.mp4
[前端] [useGenerator] payload.transitions.enabled: true
[前端] [useGenerator] payload.transitions.defaultTransition: "C:\\path\\to\\transition.mp4"
[后端] [runGeneration] transitions.enabled: true
[后端] [runGeneration] transitions.defaultTransition: "C:\\path\\to\\transition.mp4"
[后端] ========== 转场配置诊断 ==========
[后端] transitions 对象存在: true
[后端] transitions.enabled: true
[后端] transitions.defaultTransition: C:\path\to\transition.mp4
[后端] ====================================
[后端] ✅ 转场已启用,插入转场视频...
[后端] 添加片段 1: 视频标题1
[后端] 检查片段 2 的标签: tag1, tag2
[后端] 插入转场完成: 共 4 个转场, 总 9 个片段
```

### 如果出现问题:

#### 问题 1: transitions 对象不存在
```
[后端] transitions 对象存在: false
```
**原因**: 前端没有发送 transitions 对象
**检查**:
- 确认 payload 构建时 transitions 不是 undefined
- 确认 useGenerator.js 的依赖数组包含 transitions

#### 问题 2: 转场未启用
```
[后端] transitions.enabled: false
```
**原因**: 复选框没有勾选或状态没有更新
**检查**:
- 确认 UI 上 "启用转场" 复选框已勾选
- 查看前端日志确认复选框 onChange 被触发

#### 问题 3: 未设置默认转场
```
[后端] transitions.defaultTransition: (未设置)
```
**原因**: 没有选择转场视频文件
**检查**:
- 确认点击了 "选择文件" 按钮
- 确认文件选择对话框返回了有效路径
- 确认 defaultTransition 被正确设置

#### 问题 4: 转场视频文件不存在
```
[后端] ⚠️ 转场文件不存在: C:\path\to\transition.mp4
```
**原因**: 文件路径错误或文件被删除
**检查**:
- 确认文件路径正确
- 确认文件存在于指定路径

## 常见问题排查

### Q: 为什么前端显示 transitions 有值，但后端收到的是 undefined?
**A**: 可能是 payload 序列化问题。检查:
1. 确认 payload 结构正确 (不是嵌套过深)
2. 确认 transitions 对象可以 JSON.stringify
3. 检查 IPC 通信是否有错误

### Q: 为什么勾选了复选框，但 enabled 还是 false?
**A**: 可能是 React 状态更新问题。检查:
1. 确认 onChange 事件被触发
2. 确认 setTransitions 被调用
3. 确认没有其他地方重置了 transitions 状态

### Q: 为什么选择了文件，但 defaultTransition 还是 null?
**A**: 可能是文件选择 API 问题。检查:
1. 确认 window.localVideo.selectFile 存在
2. 确认文件选择对话框返回了 result.filePaths
3. 确认用户没有取消选择 (result.canceled !== true)

## 修改的文件

1. `apps/desktop/src/main/generator.cjs`
   - 添加了 runGeneration 函数开头的参数日志
   - 添加了转场配置诊断日志
   - 添加了转场未插入的详细警告

2. `apps/webui/src/hooks/useGenerator.js`
   - 添加了 payload 构建时的详细日志
   - 记录 transitions 的所有关键字段

3. `apps/webui/src/pages/GeneratorPage.jsx`
   - 添加了复选框切换时的状态日志
   - 添加了文件选择时的详细日志

## 下一步

运行生成器并收集所有日志输出，根据实际情况对照上述"预期结果"和"常见问题排查"进行诊断。
