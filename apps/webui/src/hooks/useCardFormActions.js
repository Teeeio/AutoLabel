import { useCallback, useEffect, useMemo } from "react";

export default function useCardFormActions({
  communitySession,
  setCommunityStatus,
  openCommunityLogin,
  searchSourceType,
  form,
  activeCard,
  extractBvid,
  selectedLocalFile,
  localVideoInfo,
  rangeStart,
  rangeEnd,
  tagList,
  setTagList,
  clipTags,
  setClipTags,
  tagInput,
  setTagInput,
  createCard,
  hydrateCard,
  setCards,
  loadCommunitySession,
  refreshCommunitySearch,
  setSaveNotice,
  setForm,
  setLocalVideoInfo,
  setSelectedLocalFile,
  normalizeCardTags,
  saveNotice
}) {
  const clipTagGroups = useMemo(
    () => [
      {
        label: "Series",
        single: true,
        options: ["μ's", "Aqours", "Nijigasaki", "Liella", "Hasunosora", "Bird"]
      }
    ],
    []
  );

  const toggleClipTag = useCallback((group, tag) => {
    setClipTags((prev) => {
      if (group?.single) {
        return prev[0] === tag ? [] : [tag];
      }
      return prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag];
    });
  }, [setClipTags]);

  const normalizeTag = useCallback((value) => value.trim().replace(/^#/, ""), []);

  const handleAddTag = useCallback(() => {
    const nextTag = normalizeTag(tagInput);
    if (!nextTag) return;
    setTagList((prev) => (prev.includes(nextTag) ? prev : [...prev, nextTag]));
    setTagInput("");
  }, [normalizeTag, tagInput, setTagList, setTagInput]);

  const handleRemoveTag = useCallback((tag) => {
    setTagList((prev) => prev.filter((item) => item !== tag));
  }, [setTagList]);

  const handleTagKeyDown = useCallback((event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      handleAddTag();
    }
  }, [handleAddTag]);

  const handleApplyCardTags = useCallback((card) => {
    const tags = normalizeCardTags(card?.tags);
    if (!tags.length) return;
    setTagList((prev) => Array.from(new Set([...prev, ...tags])));
    setTagInput("");
    if (card?.notes) {
      setForm((prev) => (prev.notes ? prev : { ...prev, notes: card.notes }));
    }
  }, [normalizeCardTags, setTagList, setTagInput, setForm]);

  const handleAddCard = useCallback(async () => {
    if (!communitySession) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号。" });
      openCommunityLogin();
      return;
    }

    const sourceType = searchSourceType;
    const userInputTitle = (form.title || "").trim();

    // 必须由用户输入标题，不能使用视频标题
    if (!userInputTitle) {
      alert("请先输入卡片名称");
      return;
    }

    const resolvedTitle = userInputTitle;

    if (sourceType === "bilibili") {
      const rawSource = activeCard?.bvid || form.source || "";
      const bvid = extractBvid(rawSource);
      if (!bvid) {
        alert("请选择 B 站视频。");
        return;
      }
    } else if (sourceType === "local") {
      if (!selectedLocalFile) {
        alert("请先选择本地视频文件");
        return;
      }
      if (!localVideoInfo) {
        alert("无法获取本地视频信息");
        return;
      }
    }

    const startValue = Number.isFinite(rangeStart) ? rangeStart : 0;
    const endValue = Number.isFinite(rangeEnd) ? rangeEnd : startValue + 30;
    const start = Math.min(startValue, endValue);
    const end = Math.max(startValue, endValue);

    setCommunityStatus({ loading: true, error: "" });
    let result;

    try {
      const cardData = {
        title: resolvedTitle,
        start,
        end,
        tags: [...tagList],
        clipTags: [...clipTags],
        bpm: form.bpm.trim(),
        notes: form.notes.trim(),
        visibility: form.visibility,
        source: sourceType
      };

      if (sourceType === "bilibili") {
        const rawSource = activeCard?.bvid || form.source || "";
        cardData.bvid = extractBvid(rawSource);
        cardData.aid = activeCard?.aid;
        cardData.cid = activeCard?.cid;

        // B站卡片：上传到服务器
        result = await createCard(cardData);

        if (!result.ok) {
          setCommunityStatus({ loading: false, error: result.message || "创建失败" });
          if (result.message && result.message.includes("not logged in")) {
            openCommunityLogin();
          }
          return;
        }

        const newCard = hydrateCard(result.item);
        if (newCard) {
          setCards((prev) => [newCard, ...prev]);
        }

        await loadCommunitySession();
        await refreshCommunitySearch();
        setSaveNotice("卡片已保存到社区");

      } else if (sourceType === "local") {
        // 本地卡片：直接保存到 localStorage，不上传服务器
        cardData.bvid = "";
        cardData.aid = 0;
        cardData.cid = 0;
        cardData.localPath = selectedLocalFile.path;
        cardData.localDuration = localVideoInfo.duration;
        cardData.localFileSize = localVideoInfo.fileSize;
        cardData.localWidth = localVideoInfo.width;
        cardData.localHeight = localVideoInfo.height;
        cardData.localFps = localVideoInfo.fps || 30;

        // 生成唯一的 CV 号
        const now = Date.now();
        const { generateLocalCVId } = await import("../utils/localIdGenerator.js");
        cardData.id = generateLocalCVId();
        cardData.userId = "local";
        cardData.source = "local";
        cardData.createdAt = now;
        cardData.updatedAt = now;

        // 保存到 localStorage
        const { addLocalCard } = await import("../utils/localCardStorage.js");
        addLocalCard(cardData);

        // 添加到本地状态
        const newCard = hydrateCard(cardData);
        if (newCard) {
          setCards((prev) => [newCard, ...prev]);
        }

        setSaveNotice("本地卡片已保存");
      }

      setCommunityStatus({ loading: false, error: "" });
    } catch (err) {
      setCommunityStatus({
        loading: false,
        error: sourceType === "local"
          ? "保存失败: " + err.message
          : "服务器未启动或网络错误。",
      });
      return;
    }

    setForm({
      title: "",
      source: "",
      localPath: "",
      tags: "",
      bpm: "",
      notes: "",
      visibility: "private"
    });
    setLocalVideoInfo(null);
    setSelectedLocalFile(null);
    setTagInput("");
    setTagList([]);
    setClipTags([]);
  }, [
    communitySession,
    setCommunityStatus,
    openCommunityLogin,
    searchSourceType,
    form,
    activeCard,
    extractBvid,
    selectedLocalFile,
    localVideoInfo,
    rangeStart,
    rangeEnd,
    tagList,
    clipTags,
    createCard,
    hydrateCard,
    setCards,
    loadCommunitySession,
    refreshCommunitySearch,
    setSaveNotice,
    setForm,
    setLocalVideoInfo,
    setSelectedLocalFile,
    setTagInput,
    setTagList,
    setClipTags
  ]);

  useEffect(() => {
    if (!saveNotice) return;
    const timer = setTimeout(() => setSaveNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [saveNotice, setSaveNotice]);

  return {
    handleAddCard,
    handleAddTag,
    handleRemoveTag,
    handleTagKeyDown,
    handleApplyCardTags,
    clipTagGroups,
    toggleClipTag
  };
}
