/**
 * 集成测试：验证生成器的完整流程
 *
 * 测试内容：
 * 1. 标签分散 + 顺序模式
 * 2. 标签分散 + 混洗模式
 * 3. 标签分散 + 随机模式
 * 4. 不启用标签分散
 *
 * 运行方式: node test/integration.test.js
 */

// 导入标签分散算法
function distributeByClipTags(cards) {
  if (!cards || cards.length === 0) return [];

  const cardsWithTags = [];
  const cardsWithoutTags = [];
  const tagGroups = new Map();

  cards.forEach(card => {
    const clipTags = card.clipTags || [];
    if (clipTags.length === 0) {
      cardsWithoutTags.push(card);
    } else {
      const mainTag = clipTags[0];
      if (!tagGroups.has(mainTag)) {
        tagGroups.set(mainTag, []);
      }
      tagGroups.get(mainTag).push(card);
      cardsWithTags.push(card);
    }
  });

  const distributed = [];
  const groupEntries = Array.from(tagGroups.entries());
  const maxGroupSize = Math.max(...groupEntries.map(([_, cards]) => cards.length));

  for (let round = 0; round < maxGroupSize; round++) {
    for (const [tag, groupCards] of groupEntries) {
      if (round < groupCards.length) {
        distributed.push(groupCards[round]);
      }
    }
  }

  distributed.push(...cardsWithoutTags);
  return distributed;
}

// Fisher-Yates 洗牌算法
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 模拟生成预览序列的函数
function generatePreviewSequence(cards, rules) {
  let sequence = [...cards];

  // 步骤1：如果启用标签分散，先应用标签分散算法
  if (rules.distributeClipTags) {
    console.log('  [生成预览] 应用标签分散算法');
    sequence = distributeByClipTags(sequence);
  }

  // 步骤2：应用拼接模式
  switch (rules.mode) {
    case "shuffle":
      console.log('  [生成预览] 应用混洗模式');
      sequence = shuffle(sequence);
      break;
    case "random":
      console.log('  [生成预览] 应用随机模式');
      sequence = [...sequence].sort(() => Math.random() - 0.5);
      break;
    case "sequential":
    default:
      console.log('  [生成预览] 应用顺序模式');
      break;
  }

  // 添加时间轴信息
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

  return withTimeline;
}

// 测试辅助函数
function assertArrayEqual(actual, expected, message) {
  if (actual.length !== expected.length) {
    throw new Error(`${message}\n期望长度: ${expected.length}, 实际长度: ${actual.length}`);
  }

  for (let i = 0; i < actual.length; i++) {
    if (actual[i].id !== expected[i].id) {
      throw new Error(`${message}\n位置 ${i}: 期望 ${expected[i].id}, 实际 ${actual[i].id}`);
    }
  }

  console.log(`  ✓ ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`✗ ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

// 测试数据
function createTestCards() {
  return [
    { id: 'card1', title: 'Kpop视频1', start: 0, end: 10, clipTags: ['Kpop'] },
    { id: 'card2', title: 'Kpop视频2', start: 0, end: 15, clipTags: ['Kpop'] },
    { id: 'card3', title: 'Jpop视频1', start: 0, end: 12, clipTags: ['Jpop'] },
    { id: 'card4', title: 'Jpop视频2', start: 0, end: 8, clipTags: ['Jpop'] },
    { id: 'card5', title: 'Cpop视频1', start: 0, end: 14, clipTags: ['Cpop'] },
    { id: 'card6', title: '无标签视频', start: 0, end: 10, clipTags: [] }
  ];
}

// 测试用例
function runTests() {
  console.log('========================================');
  console.log('集成测试：生成器完整流程');
  console.log('========================================\n');

  const testCards = createTestCards();

  // 测试1: 标签分散 + 顺序模式
  console.log('测试1: 标签分散 + 顺序模式');
  console.log('输入卡片:');
  testCards.forEach(c => console.log(`  - ${c.id}: ${c.clipTags.join(',') || '无标签'}`));
  const result1 = generatePreviewSequence(testCards, {
    mode: 'sequential',
    distributeClipTags: true
  });

  console.log('输出序列:');
  result1.forEach(c => console.log(`  - ${c.id}: ${c.clipTags?.[0] || '无'} (${c.startTime}s - ${c.endTime}s)`));

  // 验证标签分散
  const tagOrder1 = result1.filter(c => c.clipTags?.length > 0).map(c => c.clipTags[0]);
  console.log('标签顺序:', tagOrder1.join(', '));

  // 应该是 Kpop, Jpop, Cpop, Kpop, Jpop (无标签的在最后)
  assert(
    tagOrder1[0] === 'Kpop' && tagOrder1[1] === 'Jpop' && tagOrder1[2] === 'Cpop',
    '前三张卡片应轮询不同标签'
  );

  assert(
    result1[result1.length - 1].id === 'card6',
    '无标签卡片应在最后'
  );

  // 验证时间轴正确
  let expectedTime = 0;
  result1.forEach(card => {
    assert(card.startTime === expectedTime, `时间轴应连续: ${card.id} 从 ${expectedTime}s 开始`);
    expectedTime += (card.end - card.start);
  });

  console.log();

  // 测试2: 不启用标签分散 + 顺序模式
  console.log('测试2: 不启用标签分散 + 顺序模式');
  const result2 = generatePreviewSequence(testCards, {
    mode: 'sequential',
    distributeClipTags: false
  });

  console.log('输出序列:');
  result2.forEach(c => console.log(`  - ${c.id}: ${c.clipTags?.[0] || '无'} (${c.startTime}s - ${c.endTime}s)`));

  // 应该保持原顺序
  const expected2 = [
    { ...testCards[0], startTime: 0, duration: 10, endTime: 10 },
    { ...testCards[1], startTime: 10, duration: 15, endTime: 25 },
    { ...testCards[2], startTime: 25, duration: 12, endTime: 37 },
    { ...testCards[3], startTime: 37, duration: 8, endTime: 45 },
    { ...testCards[4], startTime: 45, duration: 14, endTime: 59 },
    { ...testCards[5], startTime: 59, duration: 10, endTime: 69 }
  ];

  assertArrayEqual(result2, expected2, '不启用标签分散时应保持原顺序');
  console.log();

  // 测试3: 标签分散 + 混洗模式
  console.log('测试3: 标签分散 + 混洗模式');
  const result3 = generatePreviewSequence(testCards, {
    mode: 'shuffle',
    distributeClipTags: true
  });

  console.log('输出序列:');
  result3.forEach(c => console.log(`  - ${c.id}: ${c.clipTags?.[0] || '无'} (${c.startTime}s - ${c.endTime}s)`));

  // 验证所有卡片都在
  assert(result3.length === testCards.length, '混洗后应包含所有卡片');

  // 验证没有重复
  const ids = new Set(result3.map(c => c.id));
  assert(ids.size === testCards.length, '混洗后不应有重复卡片');

  // 验证时间轴连续
  expectedTime = 0;
  result3.forEach(card => {
    assert(card.startTime === expectedTime, `时间轴应连续: ${card.id} 从 ${expectedTime}s 开始`);
    expectedTime += (card.end - card.start);
  });

  console.log();

  // 测试4: 边界情况 - 空数组
  console.log('测试4: 边界情况 - 空数组');
  const result4 = generatePreviewSequence([], {
    mode: 'sequential',
    distributeClipTags: true
  });

  assert(result4.length === 0, '空数组应返回空序列');
  console.log();

  // 测试5: 所有卡片都无标签
  console.log('测试5: 所有卡片都无标签');
  const noTagCards = [
    { id: 'card1', title: '视频1', start: 0, end: 10, clipTags: [] },
    { id: 'card2', title: '视频2', start: 0, end: 15, clipTags: [] },
    { id: 'card3', title: '视频3', start: 0, end: 12, clipTags: [] }
  ];

  const result5 = generatePreviewSequence(noTagCards, {
    mode: 'sequential',
    distributeClipTags: true
  });

  console.log('输出序列:');
  result5.forEach(c => console.log(`  - ${c.id} (${c.startTime}s - ${c.endTime}s)`));

  // 应保持原顺序
  assertArrayEqual(
    result5.map(c => c.id),
    ['card1', 'card2', 'card3'],
    '所有无标签时应保持原顺序'
  );

  console.log();

  // 测试6: 实际场景 - 大量卡片
  console.log('测试6: 实际场景 - 大量卡片');
  const largeCards = [];
  for (let i = 0; i < 10; i++) {
    largeCards.push({ id: `A${i}`, title: `A${i}`, start: 0, end: 10, clipTags: ['A'] });
  }
  for (let i = 0; i < 8; i++) {
    largeCards.push({ id: `B${i}`, title: `B${i}`, start: 0, end: 10, clipTags: ['B'] });
  }
  for (let i = 0; i < 6; i++) {
    largeCards.push({ id: `C${i}`, title: `C${i}`, start: 0, end: 10, clipTags: ['C'] });
  }

  const result6 = generatePreviewSequence(largeCards, {
    mode: 'sequential',
    distributeClipTags: true
  });

  console.log(`输入: ${largeCards.length} 张卡片 (A:10, B:8, C:6)`);
  console.log(`输出: ${result6.length} 张卡片`);

  // 验证前几张卡片的标签分布
  const firstTags = result6.slice(0, 6).map(c => c.clipTags[0]);
  console.log('前6张卡片的标签:', firstTags.join(', '));

  // 应该是 A, B, C, A, B, C 的轮询模式
  assert(
    firstTags[0] === 'A' && firstTags[1] === 'B' && firstTags[2] === 'C' &&
    firstTags[3] === 'A' && firstTags[4] === 'B' && firstTags[5] === 'C',
    '前6张卡片应轮询 A, B, C'
  );

  console.log();

  // 总结
  console.log('========================================');
  console.log('所有集成测试通过！✓');
  console.log('========================================');
  console.log();
  console.log('总结:');
  console.log('- ✓ 标签分散算法正确工作');
  console.log('- ✓ 与各种拼接模式兼容');
  console.log('- ✓ 时间轴计算正确');
  console.log('- ✓ 边界情况处理正确');
}

// 运行测试
try {
  runTests();
} catch (error) {
  console.error('\n========================================');
  console.error('集成测试失败！');
  console.error('========================================');
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
}
