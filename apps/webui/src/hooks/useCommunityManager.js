import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function useCommunityManager({
  getSession,
  getCards,
  login,
  logout,
  register,
  searchCardsPublic,
  updateCard,
  deleteCard,
  getCardFavorites,
  toggleCardFavorite,
  hydrateCard,
  validateCards,
  normalizeCardTags,
  setCards
}) {
  const [communitySession, setCommunitySession] = useState(null);
  const [communityLogin, setCommunityLogin] = useState({ username: "", password: "" });
  const [communityStatus, setCommunityStatus] = useState({ loading: false, error: "" });
  const [communityMyCards, setCommunityMyCards] = useState([]);
  // 使用 ref 来存储最新的卡片，避免在 handleRevalidateCards 的依赖中包含 communityMyCards
  const communityMyCardsRef = useRef(communityMyCards);
  const [communitySearchQuery, setCommunitySearchQuery] = useState("");
  const [communitySearchSort, setCommunitySearchSort] = useState("latest");
  const [communityCardResults, setCommunityCardResults] = useState([]);
  const [showCommunityAuth, setShowCommunityAuth] = useState(false);
  const [communityAuthMode, setCommunityAuthMode] = useState("login");
  const [manageFilter, setManageFilter] = useState("all");
  const [manageSearch, setManageSearch] = useState("");
  const [manageSelected, setManageSelected] = useState([]);
  const [favoriteCards, setFavoriteCards] = useState([]);
  const [favoriteCardIds, setFavoriteCardIds] = useState(new Set());

  // 同步 ref 和 state，确保 ref 始终指向最新的 communityMyCards
  useEffect(() => {
    communityMyCardsRef.current = communityMyCards;
  }, [communityMyCards]);

  const openCommunityLogin = useCallback(() => {
    setCommunityAuthMode("login");
    setCommunityStatus({ loading: false, error: "" });
    setShowCommunityAuth(true);
  }, []);

  const openCommunityRegister = useCallback(() => {
    setCommunityAuthMode("register");
    setCommunityStatus({ loading: false, error: "" });
    setShowCommunityAuth(true);
  }, []);

  const loadCommunitySession = useCallback(async () => {
    setCommunityStatus((prev) => ({ ...prev, loading: true, error: "" }));
    const session = await getSession();
    setCommunitySession(session?.user || null);

    // 加载本地卡片
    const { loadLocalCards } = await import("../utils/localCardStorage.js");
    const localCards = loadLocalCards() || [];
    const hydratedLocalCards = localCards.map(hydrateCard).filter(Boolean);

    if (session?.user) {
      const cardRes = await getCards();
      const serverCards = cardRes.ok ? cardRes.items.map(hydrateCard).filter(Boolean) : [];
      const validatedCards = await validateCards([...serverCards, ...hydratedLocalCards], "quick");
      setCommunityMyCards(validatedCards);
      setCards(validatedCards);
    } else {
      // 未登录：只显示本地卡片
      const validatedLocalCards = await validateCards(hydratedLocalCards, "quick");
      setCommunityMyCards(validatedLocalCards);
      setCards(validatedLocalCards);
    }
    setCommunityStatus((prev) => ({ ...prev, loading: false }));
  }, [getSession, getCards, hydrateCard, validateCards, setCards]);

  const refreshCommunitySearch = useCallback(async () => {
    const result = await searchCardsPublic({
      query: communitySearchQuery,
      sort: communitySearchSort
    });
    const hydratedCards = result.ok ? result.items.map(hydrateCard).filter(Boolean) : [];
    const validatedCards = await validateCards(hydratedCards, "quick");
    setCommunityCardResults(validatedCards);
  }, [communitySearchQuery, communitySearchSort, searchCardsPublic, hydrateCard, validateCards]);

  const handleCommunityLogin = useCallback(async () => {
    setCommunityStatus({ loading: true, error: "" });
    const result = await login(communityLogin);
    if (!result.ok) {
      setCommunityStatus({ loading: false, error: result.message || "登录失败" });
      return;
    }
    setCommunitySession(result.user || null);
    setCommunityLogin({ username: "", password: "" });
    setCommunityStatus({ loading: false, error: "" });
    await loadCommunitySession();
    await refreshCommunitySearch();
    setShowCommunityAuth(false);
  }, [communityLogin, login, loadCommunitySession, refreshCommunitySearch]);

  const handleCommunityRegister = useCallback(async () => {
    setCommunityStatus({ loading: true, error: "" });
    const result = await register(communityLogin);
    if (!result.ok) {
      setCommunityStatus({ loading: false, error: result.message || "注册失败" });
      return;
    }
    setCommunityStatus({ loading: false, error: "" });
    await handleCommunityLogin();
  }, [communityLogin, register, handleCommunityLogin]);

  const handleCommunityLogout = useCallback(async () => {
    await logout();
    setCommunitySession(null);
    setCommunityMyCards([]);
    setCards([]);
    setCommunityStatus({ loading: false, error: "" });
    await refreshCommunitySearch();
  }, [logout, refreshCommunitySearch, setCards]);

  const handleToggleCardVisibility = useCallback(async (card) => {
    if (!communitySession || !card) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号" });
      openCommunityLogin();
      return;
    }
    // 本地源卡片不能修改可见性
    if (card.source === "local") {
      console.warn('[Community] Local cards cannot have visibility changed');
      return;
    }
    const nextVisibility = card.visibility === "public" ? "private" : "public";
    await updateCard(card.id, { visibility: nextVisibility });
    await loadCommunitySession();
    await refreshCommunitySearch();
  }, [communitySession, updateCard, loadCommunitySession, refreshCommunitySearch, openCommunityLogin]);

  const handleDeleteCard = useCallback(async (card) => {
    if (!card) return;

    // 本地卡片直接从状态中移除
    if (card.source === "local") {
      if (!window.confirm(`确定要删除本地卡片"${card.title || '未命名卡片'}"吗？此操作不可撤销。`)) {
        return;
      }
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      setCommunityMyCards((prev) => prev.filter((c) => c.id !== card.id));
      return;
    }

    // 社区卡片需要登录并调用 API
    if (!communitySession) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号" });
      openCommunityLogin();
      return;
    }
    if (!window.confirm(`确定要删除卡片"${card.title || '未命名卡片'}"吗？此操作不可撤销。`)) {
      return;
    }
    setCommunityStatus({ loading: true, error: "" });
    const result = await deleteCard(card.id);
    if (!result.ok) {
      setCommunityStatus({ loading: false, error: result.message || "删除失败" });
      return;
    }
    await loadCommunitySession();
    await refreshCommunitySearch();
    setCommunityStatus({ loading: false, error: "" });
  }, [communitySession, deleteCard, loadCommunitySession, refreshCommunitySearch, openCommunityLogin, setCards]);

  const loadFavoriteCards = useCallback(async () => {
    if (!communitySession) return;
    const result = await getCardFavorites();
    if (result.ok) {
      const hydratedCards = result.items.map(hydrateCard).filter(Boolean);
      const validatedCards = await validateCards(hydratedCards, "quick");
      setFavoriteCards(validatedCards);
      setFavoriteCardIds(new Set(result.items.map(c => c.id)));
    }
  }, [communitySession, getCardFavorites, hydrateCard, validateCards]);

  const handleToggleCardFavorite = useCallback(async (card) => {
    if (!communitySession) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号" });
      openCommunityLogin();
      return;
    }

    // 乐观更新：立即更新UI
    const isCurrentlyFavorited = favoriteCardIds.has(card.id);
    setFavoriteCardIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlyFavorited) {
        next.delete(card.id);
      } else {
        next.add(card.id);
      }
      return next;
    });

    setCommunityStatus({ loading: true, error: "" });
    const result = await toggleCardFavorite(card.id);
    if (!result.ok) {
      // 如果失败，回滚UI更新
      setFavoriteCardIds((prev) => {
        const next = new Set(prev);
        if (isCurrentlyFavorited) {
          next.add(card.id);
        } else {
          next.delete(card.id);
        }
        return next;
      });
      setCommunityStatus({ loading: false, error: result.message || "操作失败" });
      return;
    }
    await loadFavoriteCards();
    setCommunityStatus({ loading: false, error: "" });
  }, [communitySession, toggleCardFavorite, loadFavoriteCards, openCommunityLogin, favoriteCardIds]);

  useEffect(() => {
    loadCommunitySession();
    refreshCommunitySearch();
    loadFavoriteCards();
  }, [loadCommunitySession, refreshCommunitySearch, loadFavoriteCards]);

  const filteredManageCards = useMemo(() => {
    const query = manageSearch.trim().toLowerCase();
    return communityMyCards.filter((card) => {
      if (manageFilter !== "all" && card.visibility !== manageFilter) return false;
      if (!query) return true;
      return (
        (card.title || "").toLowerCase().includes(query) ||
        (card.bvid || "").toLowerCase().includes(query) ||
        normalizeCardTags(card.tags).some((tag) => tag.toLowerCase().includes(query)) ||
        (card.notes || "").toLowerCase().includes(query)
      );
    });
  }, [communityMyCards, manageFilter, manageSearch, normalizeCardTags]);

  const filteredCommunityCards = useMemo(() => communityCardResults, [communityCardResults]);

  const handleToggleManageSelect = useCallback((tagId) => {
    setManageSelected((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }, []);

  const handleSelectAllManageTags = useCallback(() => {
    setManageSelected(filteredManageCards.map((card) => card.id));
  }, [filteredManageCards]);

  const handleClearManageSelection = useCallback(() => {
    setManageSelected([]);
  }, []);

  const handleBulkVisibility = useCallback(async (visibility) => {
    if (!communitySession) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号" });
      openCommunityLogin();
      return;
    }
    const targets = communityMyCards.filter((card) => manageSelected.includes(card.id));
    if (!targets.length) return;
    setCommunityStatus({ loading: true, error: "" });
    await Promise.all(targets.map((card) => updateCard(card.id, { visibility })));
    await loadCommunitySession();
    setCommunityStatus({ loading: false, error: "" });
    setManageSelected([]);
  }, [communitySession, communityMyCards, manageSelected, updateCard, loadCommunitySession, openCommunityLogin]);

  const handleRevalidateCards = useCallback(async () => {
    // 使用 ref 来获取最新的卡片，避免依赖 communityMyCards 导致循环
    const currentCards = communityMyCardsRef.current;
    if (!currentCards.length) return;

    setCommunityStatus({ loading: true, error: "" });

    try {
      const validatedCards = await validateCards(currentCards, "quick");
      setCards(validatedCards);
      setCommunityMyCards(validatedCards);
    } catch (error) {
      console.error('重新验证失败:', error);
      setCommunityStatus({ loading: false, error: `验证失败: ${error.message}` });
    } finally {
      setCommunityStatus({ loading: false, error: "" });
    }
  }, [validateCards, setCards]);

  return {
    communitySession,
    setCommunitySession,
    communityLogin,
    setCommunityLogin,
    communityStatus,
    setCommunityStatus,
    communityMyCards,
    setCommunityMyCards,
    communitySearchQuery,
    setCommunitySearchQuery,
    communitySearchSort,
    setCommunitySearchSort,
    communityCardResults,
    setCommunityCardResults,
    showCommunityAuth,
    setShowCommunityAuth,
    communityAuthMode,
    setCommunityAuthMode,
    openCommunityLogin,
    openCommunityRegister,
    handleCommunityLogin,
    handleCommunityRegister,
    handleCommunityLogout,
    handleToggleCardVisibility,
    handleDeleteCard,
    handleToggleCardFavorite,
    favoriteCards,
    favoriteCardIds,
    loadFavoriteCards,
    refreshCommunitySearch,
    loadCommunitySession,
    filteredManageCards,
    filteredCommunityCards,
    manageFilter,
    setManageFilter,
    manageSearch,
    setManageSearch,
    manageSelected,
    setManageSelected,
    handleToggleManageSelect,
    handleSelectAllManageTags,
    handleClearManageSelection,
    handleBulkVisibility,
    handleRevalidateCards
  };
}
