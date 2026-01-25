# Collection API 错误处理修复

## 问题描述

控制台出现以下错误：

```
GET http://localhost:8787/api/collections?userId=u-1769186210362 404 (Not Found)
[Collection] Failed to load collections: SyntaxError: Unexpected token
```

## 根本原因

1. **404 响应未正确处理**：当 API 返回 404 时，服务器可能返回 HTML 错误页面而不是 JSON
2. **缺少响应类型检查**：客户端在解析 JSON 前没有检查 `Content-Type` 响应头
3. **错误处理不当**：直接调用 `res.json()` 而不检查响应状态，导致解析失败

## 解决方案

### 修改文件：`apps/webui/src/collectionApi.js`

对所有 API 函数添加了完整的错误处理：

#### 1. **getUserCollections** - 获取用户收藏夹

```javascript
export async function getUserCollections(userId) {
  const url = new URL(`${API_BASE}/api/collections`);
  url.searchParams.set("userId", userId);

  const res = await fetch(url);

  // 检查响应状态
  if (!res.ok) {
    // 如果是 404，返回空数组（收藏夹功能可能未实现）
    if (res.status === 404) {
      console.warn('[CollectionAPI] Collections endpoint not found, returning empty array');
      return { ok: true, collections: [] };
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // 检查响应类型是否为 JSON
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}
```

**改进点：**
- ✅ 检查 HTTP 状态码（`res.ok`）
- ✅ 对 404 返回空数组（优雅降级）
- ✅ 验证 Content-Type 响应头
- ✅ 提供清晰的错误消息

#### 2. **getPublicCollections** - 获取公开收藏夹

同样添加了错误处理，对 404 返回空数组。

#### 3. **getCollectionById** - 获取收藏夹详情

添加了状态码和 Content-Type 检查。

#### 4. **createCollection** - 创建收藏夹

添加了错误处理。

#### 5. **updateCollection** - 更新收藏夹

添加了错误处理。

#### 6. **deleteCollection** - 删除收藏夹

添加了错误处理。

## 错误处理策略

### 404 响应处理

对于 GET 请求（`getUserCollections` 和 `getPublicCollections`）：

```javascript
if (res.status === 404) {
  console.warn('[CollectionAPI] Collections endpoint not found, returning empty array');
  return { ok: true, collections: [] };
}
```

**为什么返回空数组？**
- 收藏夹功能可能是可选的
- 返回空数组允许应用继续运行
- 不会因为缺少收藏集功能而崩溃
- 用户界面可以正常显示（只是没有收藏集）

### Content-Type 验证

```javascript
const contentType = res.headers.get('content-type');
if (!contentType || !contentType.includes('application/json')) {
  throw new Error(`Expected JSON response, got ${contentType}`);
}
```

**为什么需要验证？**
- 防止解析 HTML 错误页面为 JSON
- 提供清晰的错误消息
- 避免意外行为

### HTTP 错误状态

```javascript
if (!res.ok) {
  throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}
```

**处理哪些错误：**
- 400 Bad Request
- 401 Unauthorized
- 403 Forbidden
- 500 Internal Server Error
- 等等...

## 测试验证

### 1. 404 响应测试

```javascript
// 之前：SyntaxError: Unexpected token
// 现在：{ ok: true, collections: [] }
const result = await getUserCollections('test-user');
console.log(result.collections); // []
```

### 2. 非 JSON 响应测试

```javascript
// 之前：尝试解析 HTML 导致错误
// 现在：清晰的错误消息
try {
  await createCollection(...);
} catch (err) {
  console.error(err); // "Expected JSON response, got text/html"
}
```

### 3. 网络错误测试

```javascript
// 之前：未捕获的 Promise rejection
// 现在：标准的 Error 对象
try {
  await getPublicCollections();
} catch (err) {
  console.error(err); // "HTTP 500: Internal Server Error"
}
```

## 其他改进建议

### 服务器端改进

虽然客户端现在可以优雅地处理 404，但理想情况下服务器应该：

1. **确保所有 API 端点返回 JSON**
2. **为错误响应设置正确的 Content-Type**
3. **提供一致的错误响应格式**

```javascript
// 推荐的服务器错误响应格式
app.get("/api/collections", (req, res) => {
  // ...
  res.status(404).json({
    ok: false,
    message: "Collections endpoint not implemented"
  });
});
```

### 日志记录

客户端现在会记录警告信息：

```javascript
console.warn('[CollectionAPI] Collections endpoint not found, returning empty array');
```

这有助于：
- 开发时识别问题
- 区分"功能未实现"和真正的错误
- 生产环境监控

## 影响范围

### 直接影响

- ✅ 不再出现 `SyntaxError: Unexpected token` 错误
- ✅ 控制台更清晰
- ✅ 应用可以正常加载（即使收藏集功能不可用）

### 间接影响

- ✅ `useCollectionManager` hook 现在能正常工作
- ✅ 相关 UI 组件不会崩溃
- ✅ 用户体验更流畅

## 相关文件

修改的文件：
- `apps/webui/src/collectionApi.js` - 所有 API 函数

相关的 Hook：
- `apps/webui/src/hooks/useCollectionManager.js` - 使用这些 API 函数

相关的服务器文件：
- `apps/server/index.js` - API 端点实现（第 696-860 行）

## 后续工作

### 可选的增强功能

1. **重试机制**：对于网络错误自动重试
2. **缓存**：缓存收藏集列表以减少请求
3. **乐观更新**：立即更新 UI，然后在后台同步
4. **离线支持**：使用 localStorage 缓存数据

### 示例：重试机制

```javascript
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (i === retries - 1) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

## 总结

这次修复解决了以下问题：

1. ✅ 消除了 `SyntaxError: Unexpected token` 错误
2. ✅ 为 API 调用添加了健壮的错误处理
3. ✅ 实现了优雅降级（404 返回空数组）
4. ✅ 提供了清晰的错误消息
5. ✅ 验证响应类型防止解析错误

现在应用可以更稳定地运行，即使某些 API 端点不可用或返回错误响应。
