# 卡片存储重构说明

## 架构设计

### 存储层次

1. **本地存储 (localStorage)**
   - 存储所有卡片(B站来源 + 本地来源)
   - 作为主要数据源
   - 提供离线访问能力

2. **服务器备份**
   - 仅备份B站来源的卡片
   - 用于跨设备同步
   - 本地来源卡片严格不上传

### 数据流

```
                    ┌─────────────────┐
                    │   用户操作      │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  useCardSync    │
                    │   (协调层)       │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  localStorage │ │  Server API  │ │  UI Update   │
    │  (所有卡片)  │ │ (仅B站卡片)  │ │  (状态同步)  │
    └──────────────┘ └──────────────┘ └──────────────┘
```

## 已完成的重构

### 1. 服务器API (`apps/server/index.js`)

#### POST /api/cards
- **拒绝**本地来源卡片的创建请求(403错误)
- 强制 `source` 为 `bilibili`
- 清空所有本地相关字段(`localPath`, `localDuration`, etc.)

#### PATCH /api/cards/:id
- **拒绝**将卡片来源改为 `local`
- 确保服务器上只有B站卡片

### 2. 本地存储工具 (`apps/webui/src/utils/localCardStorage.js`)

提供完整的本地卡片管理功能:

```javascript
// 加载所有本地卡片
loadLocalCards()

// 保存卡片到本地
saveLocalCards(cards)

// 添加单个卡片
addLocalCard(card)

// 更新卡片
updateLocalCard(cardId, updates)

// 删除卡片
deleteLocalCard(cardId)

// 获取统计信息
getLocalCardsStats()

// 导出/导入(用于备份恢复)
exportLocalCards()
importLocalCards(jsonData, options)
```

### 3. 卡片同步Hook (`apps/webui/src/hooks/useCardSync.js`)

智能协调本地和服务器数据:

```javascript
const {
  localCards,      // 本地所有卡片
  serverCards,     // 服务器B站卡片
  allCards,        // 合并后的所有卡片
  syncStatus,      // 同步状态

  sync,            // 手动同步
  createCard,      // 创建卡片(自动区分本地/B站)
  updateCard,      // 更新卡片
  deleteCard,      // 删除卡片
} = useCardSync({
  getCards,        // API函数
  createCard,
  updateCard,
  deleteCard,
  hydrateCard,
  validateCards
});
```

## 待完成的集成步骤

### 步骤1: 在 App.jsx 中集成 useCardSync

```jsx
import useCardSync from "./hooks/useCardSync";

export default function App() {
  // ... 其他状态

  // 使用新的同步hook替代原来的卡片管理
  const cardSync = useCardSync({
    getCards: async () => communityApi.getCards(),
    createCard: async (data) => communityApi.createCard(data),
    updateCard: async (id, data) => communityApi.updateCard(id, data),
    deleteCard: async (id) => communityApi.deleteCard(id),
    hydrateCard: hydrateCard,
    validateCards: validateCards
  });

  // 更新卡片状态
  useEffect(() => {
    if (cardSync.allCards) {
      setCards(cardSync.allCards);
    }
  }, [cardSync.allCards]);

  // ... 其余代码
}
```

### 步骤2: 更新 BuilderPage 的保存逻辑

修改 `handleSaveCard` 使用新的 `createCard` 方法:

```jsx
const handleSaveCard = async () => {
  const result = await cardSync.createCard({
    source: currentBvid ? 'bilibili' : 'local',
    bvid: currentBvid || undefined,
    localPath: localPath || undefined,
    title: cardTitle,
    start: selectedStart,
    end: selectedEnd,
    tags: selectedTags,
    clipTags: selectedClipTags,
    bpm: cardBpm,
    notes: cardNotes
  });

  if (result.success) {
    // 保存成功
  } else {
    // 显示错误
  }
};
```

### 步骤3: 更新 ManagePage 的删除逻辑

```jsx
const handleDeleteCard = async (card) => {
  // 使用新的删除方法
  const result = await cardSync.deleteCard(card.id);

  if (result.success) {
    // 删除成功,useCardSync 会自动同步状态
  } else {
    alert('删除失败: ' + result.error);
  }
};
```

### 步骤4: 更新可见性切换逻辑

```jsx
const handleToggleCardVisibility = async (card) => {
  // 本地卡片不允许切换可见性
  if (card.source === 'local') {
    alert('本地来源的卡片始终为私有,无法分享。');
    return;
  }

  // B站卡片可以切换
  const result = await cardSync.updateCard(card.id, {
    visibility: card.visibility === 'public' ? 'private' : 'public'
  });

  if (!result.success) {
    alert('切换失败: ' + result.error);
  }
};
```

## 安全特性

### 1. 本地卡片私有限制
- 本地卡片 `visibility` 强制为 `private`
- 无法通过API或UI修改为 `public`
- 服务器拒绝接收本地来源的卡片

### 2. 数据隔离
- 本地卡片不上传到服务器
- 服务器上只存在B站卡片
- 跨设备同步时,本地卡片需要手动导入/导出

### 3. 错误处理
- 所有API调用都有错误处理
- 服务器验证卡片来源
- 本地存储失败不影响功能

## 用户体验

### 优点
1. **离线可用**: 本地卡片无需网络即可访问
2. **快速响应**: 本地存储读写速度快
3. **跨设备同步**: B站卡片自动备份到服务器
4. **隐私保护**: 本地文件卡片严格私有

### 注意事项
1. **本地卡片不跨设备**: 换设备需要导出/导入
2. **首次同步**: 登录后会自动同步服务器B站卡片
3. **冲突解决**: 服务器卡片优先于本地同名卡片

## 测试建议

1. **创建B站卡片**: 验证上传到服务器
2. **创建本地卡片**: 验证仅保存到本地
3. **切换可见性**: 验证本地卡片无法切换
4. **跨设备登录**: 验证B站卡片同步
5. **导出/导入**: 验证本地卡片备份恢复
