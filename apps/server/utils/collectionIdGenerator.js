/**
 * 收藏夹ID生成器
 * 格式: COL + 8位Base62字符
 * 示例: COL1a2B3c4D
 */

const PREFIX = "COL";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = 62;
const CODE_LENGTH = 8;

/**
 * 将数字转换为Base62编码
 */
function encodeBase62(num) {
  if (num === 0) return "0";

  let encoded = "";
  while (num > 0) {
    encoded = ALPHABET[num % BASE] + encoded;
    num = Math.floor(num / BASE);
  }

  // 填充到指定长度
  return encoded.padStart(CODE_LENGTH, "0");
}

/**
 * 生成收藏夹ID
 * @param {number} counter - 计数器值（通常是时间戳相关的数字）
 * @returns {string} 收藏夹ID
 */
export function generateCollectionId(counter) {
  const encoded = encodeBase62(counter);
  return PREFIX + encoded;
}

/**
 * 为新收藏夹生成唯一ID
 * 使用时间戳 + 随机数确保唯一性
 */
export function generateNewCollectionId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  const counter = timestamp * 1000 + random;
  return generateCollectionId(counter);
}
