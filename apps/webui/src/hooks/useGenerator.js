import { useCallback, useMemo, useState } from "react";

export default function useGenerator({ myCards, favorites }) {
  // 配置状态
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [cardSource, setCardSource] = useState("my"); // 'my' | 'favorites'
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);

  // 拼接规则
  const [rules, setRules] = useState({
    mode: "sequential", // 'sequential' | 'shuffle' | 'random'
    distributeClipTags: false // 是否均匀分布剪辑标签
  });

  // 输出设置
  const [output, setOutput] = useState({
    quality: "medium",
    fadeInDuration: 0,  // 淡入时长（秒）
    fadeOutDuration: 0  // 淡出时长（秒）
  });

  // 音量均衡配置
  const [volumeBalance, setVolumeBalance] = useState({
    enabled: false,              // 是否启用音量均衡
    strategy: "average",         // 均衡策略: 'average' | 'median' | 'fixed'
    targetDb: -16                // 固定目标音量（dB），仅当strategy='fixed'时使用
  });

  // 转场配置
  const [transitions, setTransitions] = useState({
    enabled: false,              // 是否启用转场
    defaultTransition: null,      // 默认转场视频路径
    tagTransitionGroups: []       // 标签组转场配置 [{ id: 1, tags: ["tag1", "tag2"], transitionPath: "path1" }]
  });

  // 预览序列
  const [previewSequence, setPreviewSequence] = useState([]);

  // 生成状态
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [generationResult, setGenerationResult] = useState(null);

  // 获取当前源卡片
  const sourceCards = useMemo(() => {
    return cardSource === "my" ? myCards : favorites;
  }, [cardSource, myCards, favorites]);

  // 过滤卡片
  const filteredCards = useMemo(() => {
    return sourceCards.filter(card => {
      // 搜索过滤
      if (searchQuery && !card.title?.includes(searchQuery)) {
        return false;
      }

      // 标签过滤
      if (selectedTags.length > 0) {
        const hasTag = selectedTags.some(tag => card.tags?.includes(tag));
        if (!hasTag) return false;
      }

      return true;
    });
  }, [sourceCards, searchQuery, selectedTags]);

  // 获取选中的卡片
  const selectedCards = useMemo(() => {
    const allCards = [...myCards, ...favorites];
    const cardMap = new Map(allCards.map(c => [c.id, c]));
    return selectedCardIds
      .map(id => cardMap.get(id))
      .filter(Boolean);
  }, [selectedCardIds, myCards, favorites]);

  // 卡片选择
  const toggleCard = useCallback((cardId) => {
    setSelectedCardIds(prev => {
      if (prev.includes(cardId)) {
        return prev.filter(id => id !== cardId);
      } else {
        return [...prev, cardId];
      }
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedCardIds(filteredCards.map(c => c.id));
  }, [filteredCards]);

  const clearSelection = useCallback(() => {
    setSelectedCardIds([]);
  }, []);

  const invertSelection = useCallback(() => {
    const selectedSet = new Set(selectedCardIds);
    const allIds = filteredCards.map(c => c.id);
    const newSelected = allIds.filter(id => !selectedSet.has(id));
    setSelectedCardIds(newSelected);
  }, [selectedCardIds, filteredCards]);

  // 标签分散算法：让相同剪辑标签的视频尽量分散
  const distributeByClipTags = useCallback((cards) => {
    if (!cards || cards.length === 0) return [];

    // 步骤1：收集所有有clipTags的卡片，按标签分组
    const cardsWithTags = [];
    const cardsWithoutTags = [];
    const tagGroups = new Map(); // tag -> Array of cards

    cards.forEach(card => {
      const clipTags = card.clipTags || [];
      if (clipTags.length === 0) {
        cardsWithoutTags.push(card);
      } else {
        // 取第一个剪辑标签作为主要分组依据
        const mainTag = clipTags[0];
        if (!tagGroups.has(mainTag)) {
          tagGroups.set(mainTag, []);
        }
        tagGroups.get(mainTag).push(card);
        cardsWithTags.push(card);
      }
    });

    // 步骤2：轮询从各组中取卡片
    const distributed = [];
    const groupEntries = Array.from(tagGroups.entries());

    // 找出最大的组大小，确定需要多少轮
    const maxGroupSize = Math.max(...groupEntries.map(([_, cards]) => cards.length));

    for (let round = 0; round < maxGroupSize; round++) {
      // 每一轮从每个组中取一个卡片（如果还有剩余）
      for (const [tag, groupCards] of groupEntries) {
        if (round < groupCards.length) {
          distributed.push(groupCards[round]);
        }
      }
    }

    // 步骤3：将没有标签的卡片添加到最后
    distributed.push(...cardsWithoutTags);

    console.log('[标签分散] 原始卡片数:', cards.length, '分散后:', distributed.length);
    console.log('[标签分散] 标签组数:', tagGroups.size, '无标签卡片:', cardsWithoutTags.length);

    return distributed;
  }, []);

  // 生成序列预览
  const generatePreview = useCallback(() => {
    if (selectedCards.length === 0) return;

    let sequence = [...selectedCards];

    // 步骤1：如果启用标签分散，先应用标签分散算法
    if (rules.distributeClipTags) {
      console.log('[生成预览] 应用标签分散算法');
      sequence = distributeByClipTags(sequence);
    }

    // 步骤2：应用拼接模式
    switch (rules.mode) {
      case "shuffle":
        // Fisher-Yates 洗牌
        for (let i = sequence.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
        }
        break;

      case "random":
        // 随机打乱顺序
        const shuffled = [...sequence].sort(() => Math.random() - 0.5);
        sequence = shuffled;
        break;

      case "sequential":
      default:
        // 保持原顺序
        break;
    }

    // 添加时间轴信息（不应用任何限制）
    let currentTime = 0;
    const withTimeline = sequence.map(card => {
      const duration = card.end - card.start;
      const item = {
        ...card,
        startTime: currentTime,
        duration: duration,
        endTime: currentTime + duration
      };
      currentTime += duration;
      return item;
    });

    setPreviewSequence(withTimeline);
  }, [selectedCards, rules, distributeByClipTags]);

  // 执行生成
  const runGenerator = useCallback(async () => {
    console.log('[useGenerator] runGenerator called');

    if (selectedCards.length === 0) {
      console.log('[useGenerator] No cards selected');
      return { ok: false, message: "请先选择卡片" };
    }

    console.log('[useGenerator] Selected cards:', selectedCards.length);

    setGenerating(true);
    setProgress({ step: "validate", label: "验证配置...", current: 1, total: 5 });

    // 收集日志
    const logs = [];

    // 设置日志监听器
    const unsubscribeLog = window.generator?.onLog?.((logMessage) => {
      logs.push(logMessage);
      console.log('[Generator Log]', logMessage);
    });

    try {
      // 生成最终序列
      const finalSequence = previewSequence.length > 0
        ? previewSequence
        : (() => {
            console.log('[useGenerator] Generating sequence from selected cards');
            let sequence = [...selectedCards];

            // 步骤1：如果启用标签分散，先应用标签分散算法
            if (rules.distributeClipTags) {
              console.log('[useGenerator] 应用标签分散算法');
              sequence = distributeByClipTags(sequence);
            }

            // 步骤2：应用拼接模式
            switch (rules.mode) {
              case "shuffle":
                console.log('[useGenerator] Applying shuffle mode');
                for (let i = sequence.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
                }
                break;
              case "random":
                console.log('[useGenerator] Applying random mode');
                const shuffled = [...sequence].sort(() => Math.random() - 0.5);
                sequence = shuffled;
                break;
            }

            // 添加时间轴信息（不应用任何限制）
            let currentTime = 0;
            const withTimeline = sequence.map(card => {
              const duration = card.end - card.start;
              const item = {
                ...card,
                startTime: currentTime,
                duration: duration,
                endTime: currentTime + duration
              };
              currentTime += duration;
              return item;
            });

            console.log('[useGenerator] Generated sequence:', withTimeline.length, 'clips');
            return withTimeline;
          })();

      if (finalSequence.length === 0) {
        throw new Error("生成的序列为空");
      }

      setProgress({ step: "prepare", label: "准备生成...", current: 2, total: 5 });

      console.log('[useGenerator] Setting up progress listener');

      // 设置进度监听器
      const unsubscribeProgress = window.generator?.onProgress?.((prog) => {
        console.log('[useGenerator] Progress update:', prog);
        setProgress({
          step: prog.step,
          label: prog.label,
          current: prog.current,
          total: prog.total
        });
      });

      // 调用生成器 API
      const payload = {
        mode: "mp4",
        selection: finalSequence.map(card => ({
          id: card.id,
          bvid: card.bvid,
          localPath: card.localPath,
          source: card.source,
          start: card.start,
          end: card.end,
          tags: card.tags || [],
          clipTags: card.clipTags || []
        })),
        rules: rules,
        output: output,
        transitions: transitions,
        volumeBalance: volumeBalance
      };

      console.log('[useGenerator] 准备调用 generator.run');
      console.log('[useGenerator] payload.transitions:', transitions);
      console.log('[useGenerator] payload.transitions.enabled:', transitions?.enabled);
      console.log('[useGenerator] payload.transitions.defaultTransition:', transitions?.defaultTransition);
      console.log('[useGenerator] payload.transitions.tagTransitionGroups:', transitions?.tagTransitionGroups);
      console.log('[useGenerator] 完整 payload:', payload);
      console.log('[useGenerator] Calling generator.run with payload:', payload);
      console.log('[useGenerator] window.generator exists?', !!window.generator);
      console.log('[useGenerator] window.generator.run exists?', !!window.generator?.run);

      const result = await window.generator?.run?.(payload);

      console.log('[useGenerator] Generator result:', result);

      // 清理监听器
      if (unsubscribeProgress) {
        unsubscribeProgress();
      }

      if (!result?.ok) {
        throw new Error(result?.message || "生成失败");
      }

      setProgress({ step: "complete", label: "完成!", current: 5, total: 5 });
      setGenerationResult({
        ...result,
        logs: logs
      });
      return result;
    } catch (error) {
      console.error("[useGenerator] Generator error:", error);
      setProgress({ step: "error", label: `错误: ${error.message}`, current: 0, total: 5 });
      return { ok: false, message: error.message };
    } finally {
      if (unsubscribeLog) {
        unsubscribeLog();
      }
      setGenerating(false);
    }
  }, [selectedCards, previewSequence, rules, output, transitions, distributeByClipTags]);

  // 收集所有卡片中的唯一标签（包括视频标签和剪辑标签）
  const allTags = useMemo(() => {
    const allCards = [...myCards, ...favorites];
    const tagSet = new Set();
    allCards.forEach(card => {
      // 收集视频标签
      if (card.tags && Array.isArray(card.tags)) {
        card.tags.forEach(tag => tagSet.add(tag));
      }
      // 收集剪辑标签
      if (card.clipTags && Array.isArray(card.clipTags)) {
        card.clipTags.forEach(tag => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  }, [myCards, favorites]);

  // 统计信息
  const stats = useMemo(() => {
    const totalDuration = selectedCards.reduce((sum, card) => {
      return sum + (card.end - card.start);
    }, 0);

    const avgDuration = selectedCards.length > 0
      ? totalDuration / selectedCards.length
      : 0;

    return {
      count: selectedCards.length,
      totalDuration: Math.round(totalDuration),
      avgDuration: Math.round(avgDuration)
    };
  }, [selectedCards]);

  return {
    // 状态
    cardSource,
    setCardSource,
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    filteredCards,
    selectedCards,
    selectedCardIds,
    rules,
    setRules,
    output,
    setOutput,
    transitions,
    setTransitions,
    volumeBalance,
    setVolumeBalance,
    previewSequence,
    generating,
    progress,
    generationResult,
    setGenerationResult,
    stats,
    allTags,

    // 方法
    toggleCard,
    selectAll,
    clearSelection,
    invertSelection,
    generatePreview,
    runGenerator
  };
}
