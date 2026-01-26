/**
 * 标签分散算法的单元测试
 *
 * 运行方式: node test/distributeClipTags.test.js
 */

// 模拟标签分散算法（从useGenerator.js中提取）
function distributeByClipTags(cards) {
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

  return distributed;
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

  console.log(`✓ ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`✗ ${message}`);
  }
  console.log(`✓ ${message}`);
}

// 测试用例
function runTests() {
  console.log('========================================');
  console.log('标签分散算法单元测试');
  console.log('========================================\n');

  // 测试1: 空数组
  console.log('测试1: 空数组');
  const result1 = distributeByClipTags([]);
  assertArrayEqual(result1, [], '空数组应返回空数组');
  console.log();

  // 测试2: 两个标签，每组数量相同
  console.log('测试2: 两个标签，每组数量相同');
  const input2 = [
    { id: 'A1', title: '视频A1', clipTags: ['舞蹈A'] },
    { id: 'A2', title: '视频A2', clipTags: ['舞蹈A'] },
    { id: 'B1', title: '视频B1', clipTags: ['舞蹈B'] },
    { id: 'B2', title: '视频B2', clipTags: ['舞蹈B'] }
  ];
  const expected2 = [
    { id: 'A1', title: '视频A1', clipTags: ['舞蹈A'] },
    { id: 'B1', title: '视频B1', clipTags: ['舞蹈B'] },
    { id: 'A2', title: '视频A2', clipTags: ['舞蹈A'] },
    { id: 'B2', title: '视频B2', clipTags: ['舞蹈B'] }
  ];
  const result2 = distributeByClipTags(input2);
  assertArrayEqual(result2, expected2, '两个标签应轮询排列');
  console.log();

  // 测试3: 三个标签，数量不同
  console.log('测试3: 三个标签，数量不同');
  const input3 = [
    { id: 'A1', title: '视频A1', clipTags: ['Kpop'] },
    { id: 'A2', title: '视频A2', clipTags: ['Kpop'] },
    { id: 'A3', title: '视频A3', clipTags: ['Kpop'] },
    { id: 'B1', title: '视频B1', clipTags: ['Jpop'] },
    { id: 'B2', title: '视频B2', clipTags: ['Jpop'] },
    { id: 'C1', title: '视频C1', clipTags: ['Cpop'] }
  ];
  const expected3 = [
    { id: 'A1', title: '视频A1', clipTags: ['Kpop'] },
    { id: 'B1', title: '视频B1', clipTags: ['Jpop'] },
    { id: 'C1', title: '视频C1', clipTags: ['Cpop'] },
    { id: 'A2', title: '视频A2', clipTags: ['Kpop'] },
    { id: 'B2', title: '视频B2', clipTags: ['Jpop'] },
    { id: 'A3', title: '视频A3', clipTags: ['Kpop'] }
  ];
  const result3 = distributeByClipTags(input3);
  assertArrayEqual(result3, expected3, '三个标签应正确轮询，多的标签在后续轮次');
  console.log();

  // 测试4: 包含无标签的卡片
  console.log('测试4: 包含无标签的卡片');
  const input4 = [
    { id: 'A1', title: '视频A1', clipTags: ['标签A'] },
    { id: 'A2', title: '视频A2', clipTags: ['标签A'] },
    { id: 'B1', title: '视频B1', clipTags: ['标签B'] },
    { id: 'N1', title: '无标签1', clipTags: [] },
    { id: 'N2', title: '无标签2', clipTags: [] }
  ];
  const expected4 = [
    { id: 'A1', title: '视频A1', clipTags: ['标签A'] },
    { id: 'B1', title: '视频B1', clipTags: ['标签B'] },
    { id: 'A2', title: '视频A2', clipTags: ['标签A'] },
    { id: 'N1', title: '无标签1', clipTags: [] },
    { id: 'N2', title: '无标签2', clipTags: [] }
  ];
  const result4 = distributeByClipTags(input4);
  assertArrayEqual(result4, expected4, '无标签的卡片应放在最后');
  console.log();

  // 测试5: 所有卡片都无标签
  console.log('测试5: 所有卡片都无标签');
  const input5 = [
    { id: 'N1', title: '无标签1', clipTags: [] },
    { id: 'N2', title: '无标签2', clipTags: [] },
    { id: 'N3', title: '无标签3', clipTags: [] }
  ];
  const expected5 = [
    { id: 'N1', title: '无标签1', clipTags: [] },
    { id: 'N2', title: '无标签2', clipTags: [] },
    { id: 'N3', title: '无标签3', clipTags: [] }
  ];
  const result5 = distributeByClipTags(input5);
  assertArrayEqual(result5, expected5, '全部无标签时应保持原顺序');
  console.log();

  // 测试6: 验证标签分散效果（连续性检查）
  console.log('测试6: 验证标签分散效果');
  const input6 = [
    { id: 'A1', title: '视频A1', clipTags: ['慢歌'] },
    { id: 'A2', title: '视频A2', clipTags: ['慢歌'] },
    { id: 'A3', title: '视频A3', clipTags: ['慢歌'] },
    { id: 'B1', title: '视频B1', clipTags: ['快歌'] },
    { id: 'B2', title: '视频B2', clipTags: ['快歌'] },
    { id: 'C1', title: '视频C1', clipTags: ['中歌'] },
    { id: 'C2', title: '视频C2', clipTags: ['中歌'] }
  ];
  const result6 = distributeByClipTags(input6);

  // 打印结果以便调试
  console.log('分散结果:', result6.map(c => `${c.id}(${c.clipTags[0] || '无'})`).join(', '));

  // 验证至少实现了部分分散
  const expected6 = [
    { id: 'A1', title: '视频A1', clipTags: ['慢歌'] },
    { id: 'B1', title: '视频B1', clipTags: ['快歌'] },
    { id: 'C1', title: '视频C1', clipTags: ['中歌'] },
    { id: 'A2', title: '视频A2', clipTags: ['慢歌'] },
    { id: 'B2', title: '视频B2', clipTags: ['快歌'] },
    { id: 'C2', title: '视频C2', clipTags: ['中歌'] },
    { id: 'A3', title: '视频A3', clipTags: ['慢歌'] }
  ];
  assertArrayEqual(result6, expected6, '标签应正确轮询分散');
  console.log();

  // 测试7: 单个标签
  console.log('测试7: 单个标签');
  const input7 = [
    { id: 'A1', title: '视频A1', clipTags: ['唯一标签'] },
    { id: 'A2', title: '视频A2', clipTags: ['唯一标签'] },
    { id: 'A3', title: '视频A3', clipTags: ['唯一标签'] }
  ];
  const result7 = distributeByClipTags(input7);
  assertArrayEqual(result7, input7, '单个标签时应保持原顺序');
  console.log();

  // 测试8: 多标签卡片（取第一个标签）
  console.log('测试8: 多标签卡片（取第一个标签）');
  const input8 = [
    { id: 'A1', title: '视频A1', clipTags: ['标签A', '标签X'] },
    { id: 'B1', title: '视频B1', clipTags: ['标签B', '标签Y'] }
  ];
  const expected8 = [
    { id: 'A1', title: '视频A1', clipTags: ['标签A', '标签X'] },
    { id: 'B1', title: '视频B1', clipTags: ['标签B', '标签Y'] }
  ];
  const result8 = distributeByClipTags(input8);
  assertArrayEqual(result8, expected8, '多标签卡片应取第一个标签分组');
  console.log();

  // 总结
  console.log('========================================');
  console.log('所有测试通过！✓');
  console.log('========================================');
}

// 运行测试
try {
  runTests();
} catch (error) {
  console.error('\n========================================');
  console.error('测试失败！');
  console.error('========================================');
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
}
