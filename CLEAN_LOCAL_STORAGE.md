# 清理本地存储指南

## 清理服务器卡片数据
✅ 已完成：`apps/server/data.json` 中的卡片已清空

## 清理浏览器本地存储

由于本地卡片存储在浏览器的 localStorage 中，需要在应用中手动清理：

### 方法1：通过浏览器开发者工具（推荐）
1. 打开应用 (http://localhost:5173)
2. 按 `F12` 打开开发者工具
3. 进入 `Application` 标签 或 `存储` 标签
4. 展开 `Local Storage` → `http://localhost:5173`
5. 删除以下键：
   - `localCards`
   - `localVideoLibrary`
   - 任何以 `rdg-` 开头的键

### 方法2：在浏览器控制台执行
打开应用后，按 `F12`，在控制台输入：

```javascript
// 清理所有本地卡片
localStorage.removeItem('localCards');

// 清理本地视频库
localStorage.removeItem('localVideoLibrary');

// 查看所有键
console.log(Object.keys(localStorage));

// 清空所有（谨慎使用）
// localStorage.clear();
```

### 方法3：重新登录
退出登录后重新登录，某些应用会自动清理本地缓存

## 清理临时文件
✅ 已完成：以下临时目录已清理
- `C:\Users\棉被暖~3\AppData\Local\Temp\rdg-generator\*`
- `C:\Users\棉被暖~3\AppData\Local\Temp\rdg-output\*`
- `C:\Users\棉被暖~3\AppData\Local\Temp\rdg-mapreduce\*`

## 保留的数据
- ✅ 用户账号（1234, demo）
- ✅ 标签定义（random-dance, love-live）
- ✅ 会话数据

## 下一步
现在你可以重新开始测试：
1. 刷新浏览器页面
2. 重新登录（如果需要）
3. 添加新卡片
