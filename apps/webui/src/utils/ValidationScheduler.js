/**
 * 卡片验证调度器 - 负责自动调度和执行卡片验证任务
 */

class ValidationScheduler {
  constructor() {
    this.tasks = new Map(); // taskId -> task config
    this.runningTasks = new Set();
    this.results = new Map(); // cardId -> validation result
    this.interval = null;
    this.concurrency = 3; // 同时验证的最大数量
    this.isRunning = false;
  }

  /**
   * 启动调度器
   * @param {Object} options - 配置选项
   * @param {number} options.interval - 验证间隔(毫秒)，默认5分钟
   * @param {number} options.concurrency - 并发数，默认3
   */
  start(options = {}) {
    if (this.isRunning) {
      console.warn('ValidationScheduler已经在运行中');
      return;
    }

    this.interval = options.interval || 5 * 60 * 1000; // 默认5分钟
    this.concurrency = options.concurrency || 3;
    this.isRunning = true;

    // 立即执行一次验证
    this.runAllTasks();

    // 定期执行验证
    this.timerId = setInterval(() => {
      this.runAllTasks();
    }, this.interval);

    console.log(`ValidationScheduler已启动, 间隔: ${this.interval}ms, 并发: ${this.concurrency}`);
  }

  /**
   * 停止调度器
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    console.log('ValidationScheduler已停止');
  }

  /**
   * 添加验证任务
   * @param {string} taskId - 任务ID
   * @param {Array} cards - 要验证的卡片数组
   * @param {Function} onProgress - 进度回调 (validated, total)
   * @param {Function} onComplete - 完成回调 (results)
   * @param {Function} validateFn - 验证函数
   */
  addTask(taskId, cards, onProgress, onComplete, validateFn) {
    const task = {
      id: taskId,
      cards: cards.filter(c => c && (c.bvid || c.localPath)), // 过滤无效卡片
      onProgress,
      onComplete,
      validateFn,
      priority: Date.now(), // 可以扩展优先级
      lastRun: 0
    };

    this.tasks.set(taskId, task);
    console.log(`添加验证任务: ${taskId}, 卡片数: ${task.cards.length}`);
  }

  /**
   * 移除验证任务
   * @param {string} taskId - 任务ID
   */
  removeTask(taskId) {
    this.tasks.delete(taskId);
    console.log(`移除验证任务: ${taskId}`);
  }

  /**
   * 更新任务的卡片列表
   * @param {string} taskId - 任务ID
   * @param {Array} cards - 新的卡片数组
   */
  updateTaskCards(taskId, cards) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.cards = cards.filter(c => c && (c.bvid || c.localPath));
      console.log(`更新任务卡片: ${taskId}, 卡片数: ${task.cards.length}`);
    }
  }

  /**
   * 执行所有任务
   */
  async runAllTasks() {
    if (!this.isRunning || this.tasks.size === 0) return;

    console.log('开始执行验证任务...');

    const allCards = [];
    const taskMap = new Map();

    // 收集所有任务中的卡片
    for (const [taskId, task] of this.tasks) {
      for (const card of task.cards) {
        allCards.push(card);
        taskMap.set(card.id, task);
      }
    }

    if (allCards.length === 0) {
      console.log('没有需要验证的卡片');
      return;
    }

    // 批量验证
    const results = await this.validateBatch(allCards);

    // 通知各个任务
    const taskResults = new Map();

    for (const [cardId, result] of Object.entries(results)) {
      const task = taskMap.get(cardId);
      if (task) {
        if (!taskResults.has(task.id)) {
          taskResults.set(task.id, []);
        }
        taskResults.get(task.id).push({ cardId, result });
      }
    }

    // 触发回调
    for (const [taskId, task] of this.tasks) {
      const cardResults = taskResults.get(taskId) || [];
      const validatedCount = cardResults.length;

      if (task.onProgress) {
        task.onProgress(validatedCount, task.cards.length);
      }

      if (task.onComplete && validatedCount > 0) {
        task.onComplete(cardResults);
      }
    }

    console.log(`验证完成: ${Object.keys(results).length} 张卡片`);
  }

  /**
   * 批量验证卡片
   * @param {Array} cards - 卡片数组
   * @returns {Promise<Object>} { cardId: validationResult }
   */
  async validateBatch(cards) {
    const results = {};
    const batches = [];

    // 分批处理
    for (let i = 0; i < cards.length; i += this.concurrency) {
      batches.push(cards.slice(i, i + this.concurrency));
    }

    for (const batch of batches) {
      const promises = batch.map(async (card) => {
        try {
          // 找到卡片所属的任务
          let validateFn = null;
          for (const task of this.tasks.values()) {
            if (task.cards.some(c => c.id === card.id)) {
              validateFn = task.validateFn;
              break;
            }
          }

          if (!validateFn) {
            throw new Error('找不到验证函数');
          }

          const result = await validateFn(card);
          return { cardId: card.id, result };
        } catch (error) {
          console.error(`验证卡片 ${card.id} 失败:`, error);
          return {
            cardId: card.id,
            result: {
              status: 'error',
              score: 0,
              issues: [`验证异常: ${error.message}`],
              warnings: [],
              lastChecked: Date.now()
            }
          };
        }
      });

      const batchResults = await Promise.all(promises);
      for (const { cardId, result } of batchResults) {
        results[cardId] = result;
      }
    }

    return results;
  }

  /**
   * 手动触发单个卡片的验证
   * @param {Object} card - 卡片对象
   * @param {Function} validateFn - 验证函数
   * @returns {Promise<Object>} 验证结果
   */
  async validateSingle(card, validateFn) {
    try {
      const result = await validateFn(card);
      this.results.set(card.id, result);
      return result;
    } catch (error) {
      console.error(`验证卡片 ${card.id} 失败:`, error);
      const errorResult = {
        status: 'error',
        score: 0,
        issues: [`验证异常: ${error.message}`],
        warnings: [],
        lastChecked: Date.now()
      };
      this.results.set(card.id, errorResult);
      return errorResult;
    }
  }

  /**
   * 获取卡片验证结果
   * @param {string} cardId - 卡片ID
   * @returns {Object|null} 验证结果
   */
  getResult(cardId) {
    return this.results.get(cardId) || null;
  }

  /**
   * 清空所有结果
   */
  clearResults() {
    this.results.clear();
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      interval: this.interval,
      concurrency: this.concurrency,
      taskCount: this.tasks.size,
      totalCards: Array.from(this.tasks.values()).reduce((sum, task) => sum + task.cards.length, 0),
      cachedResults: this.results.size
    };
  }
}

// 导出单例
const validationScheduler = new ValidationScheduler();
export default validationScheduler;
