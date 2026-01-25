export default function CommunityAuthModal({
  open,
  communityAuthMode,
  communityLogin,
  communityStatus,
  setCommunityLogin,
  setCommunityAuthMode,
  setShowCommunityAuth,
  handleCommunityLogin,
  handleCommunityRegister
}) {
  if (!open) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (communityAuthMode === "login") {
      handleCommunityLogin();
    } else {
      handleCommunityRegister();
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div className="modal-title">
            {communityAuthMode === "register" ? "注册社区账号" : "社区账号登录"}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={() => setShowCommunityAuth(false)}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>账号</label>
            <input
              type="text"
              value={communityLogin.username}
              onChange={(event) =>
                setCommunityLogin((prev) => ({ ...prev, username: event.target.value }))
              }
              placeholder="请输入账号"
              autoComplete="username"
              disabled={communityStatus.loading}
            />
          </div>
          <div className="field">
            <label>密码</label>
            <input
              type="password"
              value={communityLogin.password}
              onChange={(event) =>
                setCommunityLogin((prev) => ({ ...prev, password: event.target.value }))
              }
              placeholder="请输入密码"
              autoComplete={communityAuthMode === "login" ? "current-password" : "new-password"}
              disabled={communityStatus.loading}
            />
          </div>
          {communityStatus.error ? (
            <div className="community-error">{communityStatus.error}</div>
          ) : null}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            onClick={() =>
              setCommunityAuthMode((prev) => (prev === "login" ? "register" : "login"))
            }
            disabled={communityStatus.loading}
          >
            {communityAuthMode === "register" ? "返回登录" : "去注册"}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={communityStatus.loading || !communityLogin.username || !communityLogin.password}
          >
            {communityStatus.loading
              ? "处理中..."
              : communityAuthMode === "register"
              ? "注册"
              : "登录"}
          </button>
        </div>
      </form>
    </div>
  );
}
