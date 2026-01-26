/**
 * 音量均衡功能单元测试
 *
 * 运行方式: node test/volumeBalance.test.js
 */

// 模拟音量调整计算逻辑（从generator.cjs中提取）
function calculateVolumeAdjustmentsTest(volumes, strategy = 'average', fixedTargetDb = -16) {
  console.log(`[Volume Balance] 开始计算音量调整...`);
  console.log(`[Volume Balance] 策略: ${strategy}`);

  // 步骤2：计算目标音量
  let targetVolume;

  switch (strategy) {
    case 'median':
      // 中位数策略
      const sorted = [...volumes].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      targetVolume = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      console.log(`目标音量（中位数）: ${targetVolume.toFixed(2)} dB`);
      break;

    case 'fixed':
      // 固定值策略
      targetVolume = fixedTargetDb;
      console.log(`目标音量（固定）: ${targetVolume.toFixed(2)} dB`);
      break;

    case 'average':
    default:
      // 平均值策略
      targetVolume = volumes.reduce((sum, val) => sum + val, 0) / volumes.length;
      console.log(`目标音量（平均值）: ${targetVolume.toFixed(2)} dB`);
      break;
  }

  // 步骤3：计算每个片段的调整量
  const adjustments = volumes.map(currentVolume => {
    const adjustment = targetVolume - currentVolume;
    return adjustment;
  });

  console.log(`[Volume Balance] 计算完成，目标音量: ${targetVolume.toFixed(2)} dB`);
  return { adjustments, targetVolume };
}

// 测试辅助函数
function assert(condition, message) {
  if (!condition) {
    throw new Error(`✗ ${message}`);
  }
  console.log(`✓ ${message}`);
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${message}\n期望: ${expected}, 实际: ${actual}, 差异: ${diff}, 容差: ${tolerance}`);
  }
  console.log(`✓ ${message} (${actual.toFixed(2)} ≈ ${expected})`);
}

// 测试用例
function runTests() {
  console.log('========================================');
  console.log('音量均衡功能单元测试');
  console.log('========================================\n');

  // 测试1: 平均值策略
  console.log('测试1: 平均值策略');
  const volumes1 = [-20, -18, -22, -19, -21];
  const result1 = calculateVolumeAdjustmentsTest(volumes1, 'average');

  assertClose(result1.targetVolume, -20, 0.01, '目标音量应为平均值 -20 dB');

  // 验证调整量
  assertClose(result1.adjustments[0], 0, 0.01, '片段1 (-20dB) 调整量应为 0 dB');
  assertClose(result1.adjustments[1], -2, 0.01, '片段2 (-18dB) 调整量应为 -2 dB');
  assertClose(result1.adjustments[2], 2, 0.01, '片段3 (-22dB) 调整量应为 +2 dB');

  // 验证调整后的音量
  const adjusted1 = volumes1.map((v, i) => v + result1.adjustments[i]);
  adjusted1.forEach((v, i) => {
    assertClose(v, result1.targetVolume, 0.01, `片段${i + 1} 调整后应等于目标音量`);
  });
  console.log();

  // 测试2: 中位数策略
  console.log('测试2: 中位数策略');
  const volumes2 = [-15, -25, -18, -22, -20, -30, -16];
  const result2 = calculateVolumeAdjustmentsTest(volumes2, 'median');

  // 排序后: -30, -25, -22, -20, -18, -16, -15
  // 中位数: -20
  assertClose(result2.targetVolume, -20, 0.01, '目标音量应为中位数 -20 dB');

  // 验证极端值不被影响
  const minIndex = volumes2.indexOf(-30);
  const maxIndex = volumes2.indexOf(-15);
  assertClose(result2.adjustments[minIndex], 10, 0.01, '最安静的片段应调整 +10 dB');
  assertClose(result2.adjustments[maxIndex], -5, 0.01, '最响亮的片段应调整 -5 dB');
  console.log();

  // 测试3: 固定值策略
  console.log('测试3: 固定值策略');
  const volumes3 = [-12, -28, -15, -25];
  const result3 = calculateVolumeAdjustmentsTest(volumes3, 'fixed', -16);

  assertClose(result3.targetVolume, -16, 0.01, '目标音量应为固定值 -16 dB');

  // 验证所有片段都调整到-16 dB
  assertClose(result3.adjustments[0], -4, 0.01, '片段1 (-12dB) 应调整 -4 dB');
  assertClose(result3.adjustments[1], 12, 0.01, '片段2 (-28dB) 应调整 +12 dB');
  assertClose(result3.adjustments[2], -1, 0.01, '片段3 (-15dB) 应调整 -1 dB (原来是-1，应为-1)');
  assertClose(result3.adjustments[3], 9, 0.01, '片段4 (-25dB) 应调整 +9 dB');
  console.log();

  // 测试4: 所有片段音量相同
  console.log('测试4: 所有片段音量相同');
  const volumes4 = [-18, -18, -18, -18];
  const result4 = calculateVolumeAdjustmentsTest(volumes4, 'average');

  assertClose(result4.targetVolume, -18, 0.01, '目标音量应为 -18 dB');
  result4.adjustments.forEach(adj => {
    assertClose(adj, 0, 0.01, '所有调整量应为 0 dB');
  });
  console.log();

  // 测试5: 单个片段
  console.log('测试5: 单个片段');
  const volumes5 = [-20];
  const result5 = calculateVolumeAdjustmentsTest(volumes5, 'average');

  assertClose(result5.targetVolume, -20, 0.01, '单个片段时，目标音量应为自身');
  assertClose(result5.adjustments[0], 0, 0.01, '调整量应为 0 dB');
  console.log();

  // 测试6: 大范围音量差异
  console.log('测试6: 大范围音量差异');
  const volumes6 = [-10, -15, -20, -25, -30];
  const result6 = calculateVolumeAdjustmentsTest(volumes6, 'average');

  assertClose(result6.targetVolume, -20, 0.01, '目标音量应为 -20 dB');

  // 验证调整范围
  assertClose(result6.adjustments[0], -10, 0.01, '最响亮(-10dB)应调整 -10 dB');
  assertClose(result6.adjustments[4], 10, 0.01, '最安静(-30dB)应调整 +10 dB');

  // 验证调整后都在目标音量
  const adjusted6 = volumes6.map((v, i) => v + result6.adjustments[i]);
  adjusted6.forEach(v => {
    assertClose(v, -20, 0.01, '所有片段调整后应为 -20 dB');
  });
  console.log();

  // 测试7: 偶数个片段的中位数
  console.log('测试7: 偶数个片段的中位数');
  const volumes7 = [-15, -25, -18, -22];
  const result7 = calculateVolumeAdjustmentsTest(volumes7, 'median');

  // 排序: -25, -22, -18, -15
  // 中位数: (-22 + -18) / 2 = -20
  assertClose(result7.targetVolume, -20, 0.01, '偶数个时，目标音量应为中间两个的平均值');
  console.log();

  // 测试8: 验证不同策略的结果差异
  console.log('测试8: 验证不同策略的结果差异');
  const volumes8 = [-12, -28, -18, -22];

  const avgResult = calculateVolumeAdjustmentsTest(volumes8, 'average');
  const medianResult = calculateVolumeAdjustmentsTest(volumes8, 'median');
  const fixedResult = calculateVolumeAdjustmentsTest(volumes8, 'fixed', -16);

  console.log(`平均值策略目标: ${avgResult.targetVolume.toFixed(2)} dB`);
  console.log(`中位数策略目标: ${medianResult.targetVolume.toFixed(2)} dB`);
  console.log(`固定值策略目标: ${fixedResult.targetVolume.toFixed(2)} dB`);

  // 平均值: (-12-28-18-22)/4 = -20
  assertClose(avgResult.targetVolume, -20, 0.01, '平均值应为 -20 dB');

  // 中位数: 排序后 -28, -22, -18, -12，中位数 = (-22 + -18)/2 = -20
  assertClose(medianResult.targetVolume, -20, 0.01, '中位数应为 -20 dB');

  // 固定值: -16
  assertClose(fixedResult.targetVolume, -16, 0.01, '固定值应为 -16 dB');

  // 固定值应不同于平均值和中位数
  assert(fixedResult.targetVolume !== avgResult.targetVolume, '固定值应不同于平均值');
  console.log();

  // 总结
  console.log('========================================');
  console.log('所有测试通过！✓');
  console.log('========================================');
  console.log();
  console.log('测试覆盖:');
  console.log('- ✓ 平均值策略');
  console.log('- ✓ 中位数策略');
  console.log('- ✓ 固定值策略');
  console.log('- ✓ 相同音量场景');
  console.log('- ✓ 单个片段场景');
  console.log('- ✓ 大范围音量差异');
  console.log('- ✓ 偶数个片段的中位数');
  console.log('- ✓ 不同策略的结果差异');
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
