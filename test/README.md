# 测试说明

本目录包含"均匀分布剪辑标签"功能的自动化测试。

## 测试文件

### 1. 单元测试
**文件**: `distributeClipTags.test.js`

测试标签分散算法的核心逻辑，包括：
- 空数组处理
- 标签轮询算法
- 无标签卡片处理
- 边界情况处理

**运行**:
```bash
node test/distributeClipTags.test.js
```

**预期结果**: 所有8个测试用例通过

---

### 2. 集成测试
**文件**: `integration.test.js`

测试生成器完整流程，包括：
- 标签分散 + 顺序模式
- 标签分散 + 混洗模式
- 标签分散 + 随机模式
- 时间轴计算
- 大量卡片场景

**运行**:
```bash
node test/integration.test.js
```

**预期结果**: 所有6个测试场景通过

---

### 3. 测试报告
**文件**: `TEST_REPORT.md`

详细的测试报告文档，包含：
- 功能说明
- 测试结果
- 性能分析
- 边界情况处理
- 已知限制

---

## 快速开始

### 运行所有测试
```bash
# Windows
node test/distributeClipTags.test.js && node test/integration.test.js

# Linux/Mac
node test/distributeClipTags.test.js && node test/integration.test.js
```

### 预期输出
```
========================================
标签分散算法单元测试
========================================
...
所有测试通过！✓

========================================
集成测试：生成器完整流程
========================================
...
所有集成测试通过！✓
```

---

## 测试覆盖的功能

### ✅ 已测试
- [x] 标签分散算法逻辑
- [x] 与拼接模式的集成
- [x] 时间轴计算
- [x] 边界情况处理
- [x] 大量卡片场景

### ⚠️ 需要手动测试
- [ ] UI组件交互（需要在真实应用中测试）
- [ ] 与后端生成器的集成（需要Electron环境）

---

## 故障排查

### 测试失败
如果测试失败，请检查：
1. Node.js版本是否为v14或更高
2. 测试文件路径是否正确
3. 是否有其他错误信息

### 重新运行
```bash
# 清除Node.js缓存后重新运行
node --no-cache test/distributeClipTags.test.js
node --no-cache test/integration.test.js
```

---

## 开发指南

### 添加新的测试用例
1. 在对应的测试文件中添加新的测试函数
2. 使用 `assert()` 或 `assertArrayEqual()` 进行断言
3. 运行测试验证

### 测试模板
```javascript
// 测试模板
function testNewFeature() {
  console.log('测试: 新功能');

  // 准备测试数据
  const input = [...];

  // 执行测试
  const result = yourFunction(input);

  // 验证结果
  assert(condition, '验证消息');

  console.log('  ✓ 测试通过');
}
```

---

## 测试数据

测试使用的是模拟数据，不依赖真实的视频文件或数据库连接。这使得测试可以快速运行，且不依赖外部环境。

### 卡片数据结构
```javascript
{
  id: 'card1',           // 卡片ID
  title: '视频标题',      // 标题
  start: 0,              // 开始时间（秒）
  end: 10,               // 结束时间（秒）
  clipTags: ['Kpop']     // 剪辑标签数组
}
```

---

## 联系方式

如有问题或建议，请查看项目文档或提交issue。
