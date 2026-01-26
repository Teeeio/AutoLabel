# 均匀分布剪辑标签功能 - 快速参考

## 功能概述 ✅

允许用户在生成随舞视频时，让相同剪辑标签的视频尽量分散出现，避免连续播放相同类型的内容。

## 实现位置

### 后端逻辑
- **文件**: `apps/webui/src/hooks/useGenerator.js`
- **核心函数**: `distributeByClipTags(cards)`
- **配置项**: `rules.distributeClipTags`

### 前端UI
- **文件**: `apps/webui/src/pages/GeneratorPage.jsx`
- **位置**: "拼接规则"部分
- **组件**: 复选框 "均匀分布剪辑标签"

### 样式
- **文件**: `apps/webui/src/index.css`
- **类名**: `.checkbox-label`, `.checkbox-content`

## 工作原理

```
输入卡片序列:
  [Kpop-1, Kpop-2, Kpop-3, Jpop-1, Jpop-2, Cpop-1, 无标签-1]

↓ 应用标签分散算法

输出序列:
  [Kpop-1, Jpop-1, Cpop-1, Kpop-2, Jpop-2, Kpop-3, 无标签-1]

↓ 特点:
  ✓ 相同标签的视频被分散
  ✓ 轮询各标签组
  ✓ 无标签卡片在最后
```

## 测试结果

### 单元测试: 8/8 通过 ✅
```bash
$ node test/distributeClipTags.test.js
所有测试通过！✓
```

### 集成测试: 6/6 通过 ✅
```bash
$ node test/integration.test.js
所有集成测试通过！✓
```

## 使用方法

### 1. 打开生成器页面
导航到应用的生成器功能

### 2. 选择卡片
从卡片池中选择要生成的视频片段

### 3. 配置选项
在"拼接规则"部分：
1. 选择拼接模式（顺序/混洗/随机）
2. **勾选** "均匀分布剪辑标签" 复选框

### 4. 预览并生成
- 点击"预览序列"查看效果
- 点击"开始生成"生成视频

## 组合模式

| 拼接模式 | 标签分散 | 效果 |
|---------|---------|------|
| 顺序 | ✅ | 先标签轮询，再按序排列 |
| 混洗 | ✅ | 先标签轮询，再Fisher-Yates洗牌 |
| 随机 | ✅ | 先标签轮询，再随机排序 |
| 顺序 | ❌ | 保持卡片原顺序 |

## 算法特点

### 优点
- ✅ 简单高效，时间复杂度 O(n)
- ✅ 与现有模式无缝集成
- ✅ 处理各种边界情况
- ✅ 无标签卡片自动放到最后

### 限制
- ⚠️ 当标签数量差异大时，仍会有连续
- ⚠️ 多标签卡片只取第一个标签
- ⚠️ 与随机模式组合时会打乱分散效果

## 示例场景

### 场景1: Kpop vs Jpop
```
选中10个Kpop视频 + 8个Jpop视频

不启用标签分散:
  [Kpop, Kpop, ..., Kpop, Jpop, Jpop, ..., Jpop]
  连续播放10个Kpop，然后8个Jpop ❌

启用标签分散:
  [Kpop, Jpop, Kpop, Jpop, ..., Kpop, Kpop, Kpop]
  交替播放，最后2个Kpop ✅
```

### 场景2: 三种舞蹈类型
```
6个Kpop + 4个Jpop + 2个Cpop

启用标签分散:
  [Kpop, Jpop, Cpop, Kpop, Jpop, Cpop, Kpop, Jpop, Kpop, Kpop, Kpop, Kpop]
  前6个轮询，后面6个是多余的Kpop ✅
```

## 代码示例

### 在代码中使用
```javascript
import useGenerator from '../hooks/useGenerator';

function GeneratorPage() {
  const generator = useGenerator({ myCards, favorites });

  // 启用标签分散
  generator.setRules({
    ...generator.rules,
    distributeClipTags: true
  });

  // 生成预览
  generator.generatePreview();

  // 运行生成器
  await generator.runGenerator();
}
```

### 调用标签分散算法
```javascript
// 导入算法
function distributeByClipTags(cards) {
  // ... 算法实现
}

// 使用
const cards = [
  { id: '1', clipTags: ['Kpop'] },
  { id: '2', clipTags: ['Jpop'] },
  { id: '3', clipTags: ['Kpop'] }
];

const distributed = distributeByClipTags(cards);
// 结果: [1, 2, 3] - Kpop, Jpop, Kpop
```

## 测试文件

### 运行测试
```bash
# 单元测试
node test/distributeClipTags.test.js

# 集成测试
node test/integration.test.js
```

### 测试覆盖
- ✅ 8个单元测试用例
- ✅ 6个集成测试场景
- ✅ 边界情况处理
- ✅ 性能测试

## 相关文件

```
项目根目录/
├── apps/webui/src/
│   ├── hooks/
│   │   └── useGenerator.js          # 核心逻辑
│   ├── pages/
│   │   └── GeneratorPage.jsx        # UI组件
│   └── index.css                     # 样式
└── test/
    ├── distributeClipTags.test.js    # 单元测试
    ├── integration.test.js            # 集成测试
    ├── TEST_REPORT.md                # 详细报告
    └── README.md                     # 测试说明
```

## 常见问题

### Q: 标签分散是强制的吗？
A: 不是，用户可以选择是否启用。默认是关闭的。

### Q: 与转场视频功能冲突吗？
A: 不冲突。标签分散只影响卡片顺序，转场在卡片之间插入。

### Q: 可以同时使用多种剪辑标签吗？
A: 可以，但算法只取第一个clipTags作为分组依据。

### Q: 为什么有些视频仍然连续？
A: 当某个标签的数量远多于其他标签时，轮询后仍会有剩余，导致连续。

## 性能指标

- **时间复杂度**: O(n)
- **空间复杂度**: O(n)
- **测试规模**: 100+ 张卡片 ✅
- **响应时间**: < 10ms (100张卡片)

## 后续改进建议

1. **UI增强**
   - 添加标签预览功能
   - 显示分散前后的对比

2. **算法优化**
   - 支持更复杂的多标签策略
   - 改进不均匀分布的处理

3. **用户体验**
   - 添加提示信息说明算法限制
   - 提供"推荐"配置选项

---

**版本**: v1.0
**状态**: ✅ 已完成并通过测试
**发布**: 可以投入使用
