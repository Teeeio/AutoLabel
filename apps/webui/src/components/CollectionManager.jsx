/**
 * 收藏夹管理组件
 * 允许用户创建、编辑、删除收藏夹，以及设置可见性
 */

import { useState } from "react";

export default function CollectionManager({
  collections = [],
  publicCollections = [],
  loading = false,
  onCreateCollection,
  onUpdateCollection,
  onDeleteCollection,
  onClose
}) {
  const [mode, setMode] = useState("my"); // "my" | "public"
  const [editingCollection, setEditingCollection] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 创建收藏夹表单状态（默认私有）
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDesc, setNewCollectionDesc] = useState("");
  const [newCollectionVisibility, setNewCollectionVisibility] = useState("private"); // 默认私有

  // 编辑收藏夹表单状态
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editVisibility, setEditVisibility] = useState("private");

  const handleCreateCollection = async (e) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;

    const result = await onCreateCollection(
      newCollectionName.trim(),
      newCollectionDesc.trim(),
      newCollectionVisibility
    );

    if (result.ok) {
      setNewCollectionName("");
      setNewCollectionDesc("");
      setNewCollectionVisibility("private");
      setShowCreateForm(false);
    }
  };

  const startEdit = (collection) => {
    setEditingCollection(collection.id);
    setEditName(collection.name);
    setEditDesc(collection.description || "");
    setEditVisibility(collection.visibility);
  };

  const cancelEdit = () => {
    setEditingCollection(null);
    setEditName("");
    setEditDesc("");
    setEditVisibility("private");
  };

  const handleSaveEdit = async (collectionId) => {
    const result = await onUpdateCollection(collectionId, {
      name: editName.trim(),
      description: editDesc.trim(),
      visibility: editVisibility
    });

    if (result.ok) {
      cancelEdit();
    }
  };

  const handleDelete = async (collectionId) => {
    if (!confirm("确定要删除这个收藏夹吗？")) return;

    const result = await onDeleteCollection(collectionId);
    if (result.ok) {
      if (editingCollection === collectionId) {
        cancelEdit();
      }
    }
  };

  const displayedCollections = mode === "my" ? collections : publicCollections;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content collection-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>收藏夹管理</h2>
          <button type="button" className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* 切换标签 */}
          <div className="collection-tabs">
            <button
              type="button"
              className={"collection-tab" + (mode === "my" ? " is-active" : "")}
              onClick={() => setMode("my")}
            >
              我的收藏夹 {mode === "my" && collections.length > 0 && `(${collections.length})`}
            </button>
            <button
              type="button"
              className={"collection-tab" + (mode === "public" ? " is-active" : "")}
              onClick={() => setMode("public")}
            >
              公开收藏夹 {mode === "public" && publicCollections.length > 0 && `(${publicCollections.length})`}
            </button>
          </div>

          {mode === "my" && (
            <div className="collection-actions">
              <button
                type="button"
                className="primary"
                onClick={() => setShowCreateForm(!showCreateForm)}
              >
                {showCreateForm ? "取消创建" : "+ 新建收藏夹"}
              </button>
            </div>
          )}

          {/* 创建收藏夹表单 */}
          {showCreateForm && (
            <form className="collection-form" onSubmit={handleCreateCollection}>
              <div className="form-group">
                <label>收藏夹名称 *</label>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="输入收藏夹名称"
                  required
                  maxLength={50}
                />
              </div>

              <div className="form-group">
                <label>描述</label>
                <textarea
                  value={newCollectionDesc}
                  onChange={(e) => setNewCollectionDesc(e.target.value)}
                  placeholder="添加描述（可选）"
                  rows={2}
                  maxLength={200}
                />
              </div>

              <div className="form-group">
                <label>可见性</label>
                <select
                  value={newCollectionVisibility}
                  onChange={(e) => setNewCollectionVisibility(e.target.value)}
                >
                  <option value="private">🔒 私有</option>
                  <option value="public">🌐 公开</option>
                </select>
                <small className="form-hint">
                  {newCollectionVisibility === "private"
                    ? "只有你可以看到这个收藏夹"
                    : "其他用户可以查看和收藏这个收藏夹"}
                </small>
              </div>

              <div className="form-actions">
                <button type="submit" className="primary" disabled={!newCollectionName.trim() || loading}>
                  {loading ? "创建中..." : "创建"}
                </button>
                <button type="button" className="ghost" onClick={() => setShowCreateForm(false)}>
                  取消
                </button>
              </div>
            </form>
          )}

          {/* 收藏夹列表 */}
          <div className="collection-list">
            {loading && displayedCollections.length === 0 ? (
              <div className="collection-empty">加载中...</div>
            ) : displayedCollections.length === 0 ? (
              <div className="collection-empty">
                {mode === "my" ? "还没有收藏夹，创建一个吧！" : "暂无公开收藏夹"}
              </div>
            ) : (
              displayedCollections.map((collection) => (
                <div key={collection.id} className="collection-item">
                  {editingCollection === collection.id ? (
                    // 编辑模式
                    <div className="collection-edit">
                      <div className="form-group">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="收藏夹名称"
                          maxLength={50}
                          disabled={collection.isDefault}
                        />
                        {collection.isDefault && (
                          <small className="form-hint">默认收藏夹不能修改名称</small>
                        )}
                      </div>
                      <div className="form-group">
                        <textarea
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="描述"
                          rows={2}
                          maxLength={200}
                        />
                      </div>
                      <div className="form-group">
                        <select
                          value={editVisibility}
                          onChange={(e) => setEditVisibility(e.target.value)}
                          disabled={collection.isDefault}
                        >
                          <option value="private">🔒 私有</option>
                          <option value="public">🌐 公开</option>
                        </select>
                        {collection.isDefault && (
                          <small className="form-hint">默认收藏夹只能为私有</small>
                        )}
                      </div>
                      <div className="collection-item-actions">
                        <button
                          type="button"
                          className="primary small"
                          onClick={() => handleSaveEdit(collection.id)}
                          disabled={loading}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={cancelEdit}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 查看模式
                    <>
                      <div className="collection-info">
                        <div className="collection-name">
                          {collection.name}
                          {collection.isDefault && (
                            <span className="collection-default-badge">默认</span>
                          )}
                        </div>
                        {collection.description && (
                          <div className="collection-description">{collection.description}</div>
                        )}
                        <div className="collection-meta">
                          <span className={"collection-visibility " + collection.visibility}>
                            {collection.visibility === "public" ? "🌐 公开" : "🔒 私有"}
                          </span>
                          <span className="collection-count">
                            {collection.cardIds?.length || 0} 个卡片
                          </span>
                          {mode === "public" && collection.creatorUsername && (
                            <span className="collection-creator">
                              创建者: {collection.creatorUsername}
                            </span>
                          )}
                        </div>
                      </div>
                      {mode === "my" && !collection.isDefault && (
                        <div className="collection-item-actions">
                          <button
                            type="button"
                            className="ghost small"
                            onClick={() => startEdit(collection)}
                            title="编辑"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="ghost small"
                            onClick={() => handleDelete(collection.id)}
                            title="删除"
                          >
                            🗑️
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
