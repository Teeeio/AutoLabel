/**
 * 本地卡片ID生成器
 * 与服务端的 CV 号格式保持一致
 *
 * CV号：用于卡片ID（Card Video）
 * 格式：CV + 8位数字/字母
 * 示例：CV1a2B3c4, CV9Z8y7X6
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = ALPHABET.length;
const PREFIX = 'CV';
const CODE_LENGTH = 8;

/**
 * 将数字转换为指定进制的字符串
 */
function encode(num) {
  if (num === 0) return ALPHABET[0];

  let encoded = '';
  while (num > 0) {
    encoded = ALPHABET[num % BASE] + encoded;
    num = Math.floor(num / BASE);
  }

  return encoded;
}

/**
 * 生成下一个CV号
 * @param {number} counter - 计数器值
 * @returns {string} CV号，格式如 CV1a2B3c4
 */
export function generateCVId(counter) {
  // 确保计数器是正整数
  const num = Math.max(0, Math.floor(counter));

  // 编码为base62字符串
  let encoded = encode(num);

  // 补齐到指定长度（在前面随机填充，增加ID的随机性）
  while (encoded.length < CODE_LENGTH) {
    // 在前面添加随机字符，避免简单的顺序性
    const randomChar = ALPHABET[Math.floor(Math.random() * BASE)];
    encoded = randomChar + encoded;
  }

  // 如果超过长度，截取并重新编码
  if (encoded.length > CODE_LENGTH) {
    // 重新生成一个更大的数字来填充
    const multiplier = Math.pow(BASE, CODE_LENGTH);
    encoded = encode(num + multiplier * Math.floor(Math.random() * BASE));
    encoded = encoded.padEnd(CODE_LENGTH, ALPHABET[0]).slice(0, CODE_LENGTH);
  }

  return PREFIX + encoded;
}

/**
 * 验证CV号格式是否正确
 * @param {string} cvId - 待验证的CV号
 * @returns {boolean} 是否有效
 */
export function isValidCVId(cvId) {
  if (!cvId || typeof cvId !== 'string') {
    return false;
  }

  // 检查前缀
  if (!cvId.startsWith(PREFIX)) {
    return false;
  }

  const code = cvId.slice(PREFIX.length);

  // 检查长度
  if (code.length !== CODE_LENGTH) {
    return false;
  }

  // 检查是否只包含有效字符
  for (const char of code) {
    if (!ALPHABET.includes(char)) {
      return false;
    }
  }

  return true;
}

/**
 * 生成本地卡片的唯一 CV 号
 * 使用时间戳确保唯一性
 * @returns {string} CV号
 */
export function generateLocalCVId() {
  // 使用当前时间戳的毫秒部分作为计数器
  // 加上随机数避免同一毫秒内生成重复ID
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  const counter = timestamp * 1000 + random;

  return generateCVId(counter);
}
