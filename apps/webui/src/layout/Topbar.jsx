import { NavLink } from "react-router-dom";

export default function Topbar({
  isLoggedIn,
  isLoggingIn,
  isUnavailable,
  handleLogin,
  communitySession,
  openCommunityLogin,
  handleReload,
  handleCommunityLogout,
  handleBiliLogout,
  placeholderAvatar
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">随机随舞生成器</div>

        <div className="topbar-nav">
          <NavLink
            to="/builder"
            className={({ isActive }) =>
              "nav-button" + (isActive ? " is-active" : "")
            }
          >
            卡片制作
          </NavLink>
          <NavLink
            to="/manage"
            className={({ isActive }) =>
              "nav-button" + (isActive ? " is-active" : "")
            }
          >
            卡片管理
          </NavLink>
          <NavLink
            to="/community"
            className={({ isActive }) =>
              "nav-button" + (isActive ? " is-active" : "")
            }
          >
            卡片社区
          </NavLink>
          <NavLink
            to="/generator"
            className={({ isActive }) =>
              "nav-button" + (isActive ? " is-active" : "")
            }
          >
            生成视频
          </NavLink>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="topbar-login">
          <div className="login-card">
            <div className="login-block">
              <div className="login-label">
                <span className="bili-logo" aria-label="Bilibili" />
              </div>

              {isLoggedIn ? (
                <div className="login-status is-bili">已登录</div>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  onClick={handleLogin}
                  disabled={isLoggingIn || isUnavailable}
                >
                  {isLoggingIn ? "登录中..." : isUnavailable ? "不可用" : "登录"}
                </button>
              )}
            </div>

            <div className="login-block">
              <div className="login-label">社区</div>

              {communitySession ? (
                <div className="login-status is-app">已登录</div>
              ) : (
                <button type="button" className="ghost" onClick={openCommunityLogin}>
                  登录
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="topbar-utils">
          <button type="button" className="ghost" onClick={handleReload}>
            刷新
          </button>

          {communitySession || isLoggedIn ? (
            <div className="profile-avatar-wrap is-active">
              <img
                className="profile-avatar"
                src={placeholderAvatar}
                alt="avatar"
              />

              <div className="profile-menu">
                <button
                  type="button"
                  className="ghost"
                  onClick={handleCommunityLogout}
                  disabled={!communitySession}
                >
                  登出社区
                </button>

                <button
                  type="button"
                  className="ghost"
                  onClick={handleBiliLogout}
                  disabled={!isLoggedIn}
                >
                  登出B站
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}



