/**
 * 卡片验证器 - 负责验证卡片的有效性
 */

class CardValidator {
  /**
   * 快速验证 - 检查基本可用性
   * @param {Object} card - 卡片对象
   * @returns {Promise<Object>} { status, score, issues, warnings }
   */
  async quickValidate(card) {
    if (!card) {
      return {
        status: 'invalid',
        score: 0,
        issues: ['卡片数据为空'],
        warnings: []
      };
    }

    switch (card.source || 'bilibili') {
      case 'bilibili':
        return this.quickValidateBilibili(card);
      case 'local':
        return this.quickValidateLocal(card);
      default:
        return {
          status: 'unknown',
          score: 50,
          issues: ['未知视频来源'],
          warnings: []
        };
    }
  }

  /**
   * 深度验证 - 全面检查
   * @param {Object} card - 卡片对象
   * @returns {Promise<Object>} 验证结果
   */
  async deepValidate(card) {
    if (!card) {
      return {
        status: 'invalid',
        score: 0,
        issues: ['卡片数据为空'],
        warnings: []
      };
    }

    switch (card.source || 'bilibili') {
      case 'bilibili':
        return this.deepValidateBilibili(card);
      case 'local':
        return this.deepValidateLocal(card);
      default:
        return {
          status: 'unknown',
          score: 50,
          issues: ['未知视频来源'],
          warnings: []
        };
    }
  }

  /**
   * 快速验证B站视频
   */
  async quickValidateBilibili(card) {
    const issues = [];
    const warnings = [];
    let score = 100;
    let status = 'valid';

    // 1. 基本字段检查
    if (!card.bvid) {
      return {
        status: 'invalid',
        score: 0,
        issues: ['缺少BVID'],
        warnings: [],
        bilibili: { videoExists: false, lastChecked: Date.now() }
      };
    }

    // 2. 通过Electron API快速检查视频是否存在
    try {
      // 使用preview:info API通过Electron获取视频信息
      const info = await window.preview?.info?.({ bvid: card.bvid });

      if (!info || !info.duration) {
        issues.push('视频不存在或已被删除');
        score = 0;
        status = 'invalid';
      } else {
        // 检查视频时长
        // 检查片段时间范围
        if (card.end > info.duration) {
          warnings.push(`结束时间${card.end}超出视频时长${info.duration}`);
          score -= 20;
        }

        if (card.start >= info.duration) {
          issues.push(`起始时间${card.start}超出视频时长${info.duration}`);
          score = 0;
          status = 'invalid';
        }

        // 检查CID是否匹配
        if (card.cid && info.cid !== card.cid) {
          warnings.push(`CID不匹配: 期望${card.cid}, 实际${info.cid}`);
          score -= 15;
        }
      }
    } catch (error) {
      warnings.push(`验证失败: ${error.message}`);
      score = 70;
    }

    // 根据分数确定状态
    if (score >= 80) status = 'valid';
    else if (score >= 50) status = 'warning';
    else status = 'invalid';

    return {
      status,
      score: Math.max(0, score),
      issues,
      warnings,
      bilibili: {
        videoExists: score > 0,
        isAccessible: score > 0,
        lastChecked: Date.now()
      },
      lastChecked: Date.now()
    };
  }

  /**
   * 深度验证B站视频
   */
  async deepValidateBilibili(card) {
    const quickResult = await this.quickValidateBilibili(card);

    if (quickResult.status === 'invalid') {
      return quickResult;
    }

    try {
      // 检查片段范围是否有效
      const duration = quickResult.duration || await this.getVideoDuration(card.bvid);

      if (duration) {
        if (card.start < 0 || card.start >= duration) {
          quickResult.issues.push('起始时间超出视频范围');
          quickResult.score = 0;
          quickResult.status = 'invalid';
        }

        if (card.end > duration) {
          quickResult.issues.push('结束时间超出视频范围');
          quickResult.score = 0;
          quickResult.status = 'invalid';
        }

        if (card.end <= card.start) {
          quickResult.issues.push('结束时间必须大于起始时间');
          quickResult.score = 0;
          quickResult.status = 'invalid';
        }
      }

    } catch (error) {
      quickResult.warnings.push(`深度验证失败: ${error.message}`);
    }

    return quickResult;
  }

  /**
   * 快速验证本地视频
   */
  async quickValidateLocal(card) {
    const issues = [];
    const warnings = [];
    let score = 100;
    let status = 'valid';

    if (!card.localPath) {
      return {
        status: 'invalid',
        score: 0,
        issues: ['缺少本地文件路径'],
        warnings: [],
        local: { fileExists: false, lastChecked: Date.now() }
      };
    }

    // 检查文件是否存在
    const result = await window.localVideo?.checkExists?.(card.localPath);

    if (!result || !result.ok || result.exists === false) {
      return {
        status: 'invalid',
        score: 0,
        issues: ['文件不存在'],
        warnings: [],
        local: { fileExists: false, lastChecked: Date.now() }
      };
    }

    // 快速获取视频信息
    try {
      const infoResult = await window.localVideo?.getInfoQuick?.(card.localPath);
      if (infoResult?.ok && infoResult.info) {
        const info = infoResult.info;

        if (info.error) {
          warnings.push(`视频信息获取失败: ${info.error}`);
          score = 70;
        } else {
          // 检查片段时间范围
          if (info.duration) {
            if (card.end > info.duration) {
              warnings.push(`结束时间${card.end}超出视频时长${info.duration}`);
              score -= 20;
            }

            if (card.start >= info.duration) {
              issues.push(`起始时间${card.start}超出视频时长${info.duration}`);
              score = 0;
              status = 'invalid';
            }
          }
        }
      }
    } catch (error) {
      warnings.push(`验证失败: ${error.message}`);
      score = 70;
    }

    return {
      status: score >= 70 ? 'valid' : score >= 40 ? 'warning' : 'invalid',
      score: Math.max(0, score),
      issues,
      warnings,
      local: {
        fileExists: true,
        lastChecked: Date.now()
      },
      lastChecked: Date.now()
    };
  }

  /**
   * 深度验证本地视频
   */
  async deepValidateLocal(card) {
    const quickResult = await this.quickValidateLocal(card);
    return quickResult; // 暂时返回快速验证结果
  }

  /**
   * 获取B站视频时长
   */
  async getVideoDuration(bvid) {
    try {
      const info = await window.preview?.info?.({ bvid });
      if (info?.duration) {
        return info.duration;
      }
    } catch (error) {
      console.error('获取视频时长失败:', error);
    }
    return null;
  }
}

// 导出单例
const cardValidator = new CardValidator();
export default cardValidator;
