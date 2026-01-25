# GeneratorPage 设计文档

## 一、页面概述

### 功能定位
GeneratorPage 是随机舞蹈生成器的核心功能页面,允许用户:
1. 从"我的卡片"和"收藏的卡片"中选择素材
2. 配置拼接规则(随机/顺序/混洗等)
3. 预览最终视频序列
4. 调用生成器脚本输出最终视频

### 页面路由
- 路径: `/generator`
- 导航名称: "生成视频"

## 二、数据结构设计

### 1. 生成配置状态
```javascript
const generatorConfig = {
  // 选择的卡片列表
  selectedCards: [],

  // 卡片来源池
  cardSources: {
    myCards: [],        // 我的卡片
    favorites: []       // 收藏的卡片
  },

  // 拼接规则
  rules: {
    mode: 'random',     // 'random' | 'sequential' | 'shuffle' | 'smart'
    maxDuration: 300,   // 最大总时长(秒)
    maxCount: 50,       // 最大卡片数量
    overlap: 0.5,       // 片段重叠时间(秒),用于转场
    transitions: true,  // 是否启用转场效果

    // 智能模式参数
    smartRules: {
      groupByTag: false,    // 按标签分组
      avoidDuplicates: true,// 避免连续重复
      bpmMatch: false,      // BPM匹配
      varietyScore: 0.5     // 多样性评分(0-1)
    }
  },

  // 输出设置
  output: {
    format: 'mp4',
    quality: 'high',      // 'low' | 'medium' | 'high'
    resolution: '1080p',
    fps: 60,
    bitrate: '8M'
  }
}
```

### 2. 卡片项结构(扩展)
```javascript
const generatorCardItem = {
  // 原有字段
  id, title, bvid, localPath, start, end, tags, source,

  // 生成器专用字段
  isSelected: false,     // 是否已选中
  order: null,           // 自定义排序位置
  weight: 1.0,           // 随机权重(越高越容易被选中)
  disabled: false,       // 是否禁用(时长超限等)
  disableReason: ''      // 禁用原因
}
```

## 三、UI布局设计

### 整体布局
```
┌─────────────────────────────────────────────────────────────────┐
│  GeneratorPage                                                   │
├──────────────┬──────────────────────────────────────┬───────────┤
│              │                                       │           │
│  Card Pool   │      Selected Cards & Rules         │  Preview  │
│  (30%)       │           (40%)                     │   (30%)   │
│              │                                       │           │
│  - Source    │  - Card List                         │  - Sequence │
│  - Filter    │  - Sort/Order                        │  - Player  │
│  - Search    │  - Rules Config                      │  - Timeline │
│              │  - Duration Stats                    │           │
│              │  - Generate Button                   │           │
└──────────────┴──────────────────────────────────────┴───────────┘
```

### 详细组件设计

#### 1. 左侧:卡片池 (CardPoolPanel)
```jsx
<div className="generator-pool">
  {/* 来源切换标签 */}
  <div className="pool-tabs">
    <Tab active={source === 'my'} onClick={() => setSource('my')}>
      我的卡片 ({myCards.length})
    </Tab>
    <Tab active={source === 'favorites'} onClick={() => setSource('favorites')}>
      收藏夹 ({favorites.length})
    </Tab>
  </div>

  {/* 过滤和搜索 */}
  <div className="pool-filters">
    <SearchInput value={search} onChange={setSearch} />
    <TagFilter selectedTags={tags} onChange={setTags} />
    <SourceFilter source={source} onChange={setSource} />
  </div>

  {/* 卡片列表 */}
  <div className="pool-list">
    {filteredCards.map(card => (
      <CardItem
        key={card.id}
        card={card}
        isSelected={selectedIds.includes(card.id)}
        disabled={card.disabled}
        onSelect={() => toggleSelect(card.id)}
      />
    ))}
  </div>

  {/* 批量操作 */}
  <div className="pool-actions">
    <button onClick={selectAll}>全选</button>
    <button onClick={selectNone}>清空</button>
    <button onClick={invertSelection}>反选</button>
  </div>
</div>
```

#### 2. 中间:选中卡片和规则配置 (ConfigPanel)
```jsx
<div className="generator-config">
  {/* 选中卡片列表 */}
  <div className="selected-section">
    <div className="section-header">
      <h3>已选择 ({selectedCards.length})</h3>
      <div className="stats">
        总时长: {totalDuration}s |
        平均: {avgDuration}s
      </div>
    </div>

    <div className="selected-list">
      {selectedCards.map(card => (
        <DraggableCard
          key={card.id}
          card={card}
          onReorder={handleReorder}
          onRemove={() => removeCard(card.id)}
          showDuration={true}
        />
      ))}
    </div>
  </div>

  {/* 拼接规则配置 */}
  <div className="rules-section">
    <h3>拼接规则</h3>

    {/* 模式选择 */}
    <RadioGroup value={rules.mode} onChange={setMode}>
      <RadioButton value="random">
        <strong>随机模式</strong>
        <p>随机选择并排列卡片</p>
      </RadioButton>
      <RadioButton value="sequential">
        <strong>顺序模式</strong>
        <p>按当前顺序拼接</p>
      </RadioButton>
      <RadioButton value="shuffle">
        <strong>混洗模式</strong>
        <p>打乱顺序后拼接</p>
      </RadioButton>
      <RadioButton value="smart">
        <strong>智能模式</strong>
        <p>基于标签/BPM智能排列</p>
      </RadioButton>
    </RadioGroup>

    {/* 参数调整 */}
    <div className="rule-params">
      <Slider
        label="最大时长"
        value={rules.maxDuration}
        onChange={setMaxDuration}
        min={60}
        max={600}
        unit="秒"
      />

      <Slider
        label="最大数量"
        value={rules.maxCount}
        onChange={setMaxCount}
        min={5}
        max={100}
      />

      {rules.mode === 'smart' && (
        <SmartRuleConfig
          rules={rules.smartRules}
          onChange={setSmartRules}
        />
      )}
    </div>
  </div>

  {/* 输出设置 */}
  <div className="output-section">
    <h3>输出设置</h3>
    <Select label="质量" value={output.quality} onChange={setQuality}>
      <option value="low">低 (720p, 30fps)</option>
      <option value="medium">中 (1080p, 60fps)</option>
      <option value="high">高 (1080p, 60fps, 高码率)</option>
    </Select>
  </div>

  {/* 生成按钮 */}
  <div className="generate-actions">
    <PreviewButton onClick={handlePreview}>
      预览序列
    </PreviewButton>
    <GenerateButton
      onClick={handleGenerate}
      disabled={selectedCards.length === 0}
    >
      开始生成
    </GenerateButton>
  </div>
</div>
```

#### 3. 右侧:预览播放器 (PreviewPanel)
```jsx
<div className="generator-preview">
  {/* 序列预览 */}
  <div className="sequence-preview">
    <h3>序列预览</h3>

    {/* 时间轴 */}
    <Timeline>
      {previewSequence.map((item, index) => (
        <TimelineItem
          key={item.id}
          item={item}
          startTime={item.startTime}
          duration={item.duration}
          onClick={() => playItem(index)}
        />
      ))}
    </Timeline>
  </div>

  {/* 播放器 */}
  <div className="preview-player">
    {currentItem ? (
      <VideoPlayer
        src={getItemSource(currentItem)}
        startTime={currentItem.localStart}
        endTime={currentItem.localEnd}
        autoPlay={false}
      />
    ) : (
      <Placeholder>点击"预览序列"查看效果</Placeholder>
    )}
  </div>

  {/* 序列统计 */}
  <div className="sequence-stats">
    <div className="stat-item">
      <label>片段数量</label>
      <span>{previewSequence.length}</span>
    </div>
    <div className="stat-item">
      <label>总时长</label>
      <span>{formatTime(totalDuration)}</span>
    </div>
    <div className="stat-item">
      <label>平均时长</label>
      <span>{formatTime(avgDuration)}</span>
    </div>
  </div>
</div>
```

## 四、核心交互流程

### 流程1: 选择卡片
```
1. 用户在左侧"卡片池"浏览
   ├─ 切换来源: 我的卡片 / 收藏夹
   ├─ 使用搜索框过滤卡片
   └─ 使用标签过滤

2. 点击卡片选择
   ├─ 单击: 切换选中状态
   ├─ 拖拽: 添加到中间区域
   └─ 批量操作: 全选/清空/反选

3. 选中的卡片自动添加到中间"选中卡片"列表
```

### 流程2: 配置规则
```
1. 选择拼接模式
   ├─ 随机: 每次生成时随机选择和排列
   ├─ 顺序: 按当前列表顺序
   ├─ 混洗: 打乱顺序
   └─ 智能: 基于规则优化

2. 调整参数
   ├─ 最大时长限制
   ├─ 最大数量限制
   └─ 转场效果开关

3. 实时预览统计
   ├─ 总时长
   ├─ 卡片数量
   └─ 平均时长
```

### 流程3: 预览序列
```
1. 点击"预览序列"按钮
   ↓
2. 根据规则生成虚拟序列
   ↓
3. 在右侧时间轴显示
   ↓
4. 点击时间轴项播放预览
   ↓
5. 可手动调整顺序或移除项
```

### 流程4: 生成视频
```
1. 点击"开始生成"按钮
   ↓
2. 验证配置
   ├─ 检查卡片数量
   ├─ 检查总时长
   └─ 检查文件可用性
   ↓
3. 显示进度弹窗
   ├─ 下载素材
   ├─ 剪辑片段
   ├─ 拼接视频
   └─ 导出文件
   ↓
4. 完成提示
   ├─ 显示输出路径
   ├─ 打开文件夹
   └─ 重新生成
```

## 五、关键技术点

### 1. 卡片选择和过滤
```javascript
// 合并我的卡片和收藏
const allAvailableCards = useMemo(() => {
  const myCardsFiltered = myCards.filter(c => !c.disabled);
  const favCardsFiltered = favorites.filter(c => !c.disabled);

  // 去重(收藏夹中已有的不重复显示)
  const favIds = new Set(favCardsFiltered.map(c => c.id));
  const uniqueMyCards = myCardsFiltered.filter(c => !favIds.has(c.id));

  return [...uniqueMyCards, ...favCardsFiltered];
}, [myCards, favorites]);

// 过滤逻辑
const filteredCards = useMemo(() => {
  return allAvailableCards.filter(card => {
    // 搜索过滤
    if (search && !card.title.includes(search)) return false;

    // 标签过滤
    if (selectedTags.length > 0) {
      const hasTag = selectedTags.some(tag => card.tags.includes(tag));
      if (!hasTag) return false;
    }

    // 来源过滤
    if (sourceFilter === 'bilibili' && card.source !== 'bilibili') return false;
    if (sourceFilter === 'local' && card.source !== 'local') return false;

    return true;
  });
}, [allAvailableCards, search, selectedTags, sourceFilter]);
```

### 2. 拖拽排序
```javascript
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove } from '@dnd-kit/sortable';

function ConfigPanel() {
  const [selectedCards, setSelectedCards] = useState([]);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setSelectedCards(cards => {
        const oldIndex = cards.findIndex(c => c.id === active.id);
        const newIndex = cards.findIndex(c => c.id === over.id);
        return arrayMove(cards, oldIndex, newIndex);
      });
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={selectedCards.map(c => c.id)}>
        {selectedCards.map(card => (
          <SortableCard key={card.id} card={card} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
```

### 3. 序列生成逻辑
```javascript
function generateSequence(cards, rules) {
  let sequence = [...cards];

  switch (rules.mode) {
    case 'random':
      // 随机选择(考虑权重)
      sequence = weightedRandomSelect(cards, rules.maxCount, rules.maxDuration);
      break;

    case 'shuffle':
      // 打乱顺序
      sequence = shuffleArray(cards);
      break;

    case 'smart':
      // 智能排列
      sequence = smartArrange(cards, rules.smartRules);
      break;

    case 'sequential':
    default:
      // 保持原顺序
      break;
  }

  // 应用时长和数量限制
  sequence = applyLimits(sequence, rules.maxDuration, rules.maxCount);

  return sequence;
}

function weightedRandomSelect(cards, maxCount, maxDuration) {
  // 根据权重随机选择
  let totalDuration = 0;
  const selected = [];

  // 可选池
  const pool = [...cards];

  while (pool.length > 0 && selected.length < maxCount && totalDuration < maxDuration) {
    // 计算总权重
    const totalWeight = pool.reduce((sum, c) => sum + (c.weight || 1), 0);

    // 随机选择
    let random = Math.random() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      random -= pool[i].weight || 1;
      if (random <= 0) {
        const card = pool.splice(i, 1)[0];
        selected.push(card);
        totalDuration += (card.end - card.start);
        break;
      }
    }
  }

  return selected;
}
```

### 4. 调用生成器API
```javascript
async function handleGenerate() {
  // 1. 生成最终序列
  const finalSequence = generateSequence(selectedCards, rules);

  // 2. 调用生成器
  const progressHandler = (progress) => {
    console.log(`[${progress.step}] ${progress.label}`);
    setGenerationProgress(progress);
  };

  try {
    const result = await window.generator.run({
      mode: output.format,
      selection: finalSequence.map(card => ({
        id: card.id,
        bvid: card.bvid,
        localPath: card.localPath,
        source: card.source,
        start: card.start,
        end: card.end
      })),
      rules: rules,
      output: output
    }, progressHandler);

    if (result.ok) {
      setGenerationResult(result);
      showSuccess(`生成完成: ${result.outputPath}`);
    }
  } catch (error) {
    console.error('Generation failed:', error);
    showError(`生成失败: ${error.message}`);
  }
}
```

## 六、状态管理

### 使用自定义Hook
```javascript
// useGenerator.js
export default function useGenerator() {
  const [config, setConfig] = useState({
    selectedCards: [],
    rules: { mode: 'random', maxDuration: 300, maxCount: 50 },
    output: { quality: 'medium' }
  });

  const [previewSequence, setPreviewSequence] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);

  // 卡片选择逻辑
  const toggleCard = useCallback((cardId) => {
    setConfig(prev => ({
      ...prev,
      selectedCards: prev.selectedCards.includes(cardId)
        ? prev.selectedCards.filter(id => id !== cardId)
        : [...prev.selectedCards, cardId]
    }));
  }, []);

  // 生成序列预览
  const generatePreview = useCallback(() => {
    const cards = getCardsByIds(config.selectedCards);
    const sequence = generateSequence(cards, config.rules);
    setPreviewSequence(sequence);
  }, [config.selectedCards, config.rules]);

  // 执行生成
  const runGenerator = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await window.generator.run(config, handleProgress);
      return result;
    } finally {
      setGenerating(false);
    }
  }, [config]);

  return {
    config,
    setConfig,
    previewSequence,
    generatePreview,
    runGenerator,
    generating,
    progress
  };
}
```

## 七、UI组件库需求

### 新增组件
1. **CardItem** - 卡片选择项
2. **DraggableCard** - 可拖拽卡片
3. **RadioGroup** - 单选按钮组
4. **Slider** - 滑块输入
5. **Timeline** - 时间轴
6. **TimelineItem** - 时间轴项
7. **SmartRuleConfig** - 智能规则配置面板

### 复用组件
- SearchInput (复用)
- TagFilter (复用)
- VideoPlayer (复用 LocalVideoPlayer)

## 八、实现优先级

### Phase 1: MVP (最小可行产品)
- ✅ 基础三栏布局
- ✅ 卡片池浏览和选择
- ✅ 选中卡片列表
- ✅ 简单规则配置(顺序模式)
- ✅ 调用生成器API

### Phase 2: 核心功能
- ✅ 拖拽排序
- ✅ 随机/混洗模式
- ✅ 序列预览
- ✅ 进度显示

### Phase 3: 高级功能
- ✅ 智能拼接模式
- ✅ BPM匹配
- ✅ 转场效果
- ✅ 批量操作优化

## 九、技术债务和注意事项

1. **性能考虑**: 大量卡片时需要虚拟滚动
2. **内存管理**: 预览时避免加载所有视频
3. **错误处理**: 处理本地文件缺失、B站视频失效等
4. **用户体验**: 保存上次的配置,避免重复配置
5. **可访问性**: 键盘导航支持

## 十、下一步行动

1. ✅ 创建页面组件骨架
2. ✅ 实现卡片池和选择逻辑
3. ✅ 集成拖拽排序
4. ✅ 实现规则配置UI
5. ✅ 连接生成器API
6. ✅ 添加进度弹窗
7. ✅ 测试完整流程
