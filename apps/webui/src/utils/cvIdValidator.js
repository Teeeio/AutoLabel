/**
 * CV号验证和格式化工具
 */

const CV_PREFIX = 'CV';
const CV_LENGTH = 8; // CV前缀 + 8位字符
const CV_FULL_LENGTH = CV_PREFIX.length + CV_LENGTH;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * 检查是否是有效的CV号格式
 * @param {string} id - 待检查的ID
 * @returns {boolean} 是否是有效的CV号
 */
export function isValidCVId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // 检查长度
  if (id.length !== CV_FULL_LENGTH) {
    return false;
  }

  // 检查前缀
  if (!id.startsWith(CV_PREFIX)) {
    return false;
  }

  // 检查字符是否都在字母表中
  const code = id.slice(CV_PREFIX.length);
  for (const char of code) {
    if (!ALPHABET.includes(char)) {
      return false;
    }
  }

  return true;
}

/**
 * 检查是否是本地卡片ID
 * @param {string} id - 待检查的ID
 * @returns {boolean} 是否是本地卡片
 */
export function isLocalCardId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // 本地卡片ID格式：local-时间戳
  return id.startsWith('local-');
}

/**
 * 检查是否是旧格式的卡片ID（兼容性检查）
 * @param {string} id - 待检查的ID
 * @returns {boolean} 是否是旧格式ID
 */
export function isLegacyCardId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // 旧格式：c-时间戳
  return id.startsWith('c-');
}

/**
 * 格式化显示卡片ID
 * @param {string} id - 卡片ID
 * @returns {string} 格式化后的显示文本
 */
export function formatCardId(id) {
  if (!id) {
    return '未知ID';
  }

  if (isValidCVId(id)) {
    return id; // CV号直接显示
  }

  if (isLocalCardId(id)) {
    return '本地卡片';
  }

  if (isLegacyCardId(id)) {
    return id; // 旧格式ID直接显示
  }

  return id;
}

/**
 * 获取卡片ID类型
 * @param {string} id - 卡片ID
 * @returns {string} 类型：'cv' | 'local' | 'legacy' | 'unknown'
 */
export function getCardIdType(id) {
  if (isValidCVId(id)) {
    return 'cv';
  }

  if (isLocalCardId(id)) {
    return 'local';
  }

  if (isLegacyCardId(id)) {
    return 'legacy';
  }

  return 'unknown';
}

/**
 * 从卡片ID中提取简短标识
 * @param {string} id - 卡片ID
 * @returns {string} 简短标识
 */
export function getCardIdShort(id) {
  if (!id) {
    return '';
  }

  if (isValidCVId(id)) {
    return id; // CV号本身就够短
  }

  if (isLocalCardId(id)) {
    return '本地';
  }

  if (isLegacyCardId(id)) {
    return id.slice(0, 12) + '...';
  }

  return id.slice(0, 12);
}

/**
 * 生成卡片分享链接
 * @param {string} id - 卡片ID
 * @param {string} baseUrl - 基础URL（可选）
 * @returns {string} 分享链接
 */
export function generateCardShareLink(id, baseUrl = '') {
  if (!id) {
    return '';
  }

  // 如果是CV号，生成格式化的分享链接
  if (isValidCVId(id)) {
    return `${baseUrl}/card/${id}`;
  }

  return `${baseUrl}/card/${id}`;
}
