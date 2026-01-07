function isValidSegment(startSeconds, endSeconds) {
  if (typeof startSeconds !== "number" || typeof endSeconds !== "number") return false;
  if (startSeconds < 0 || endSeconds <= startSeconds) return false;
  return true;
}

module.exports = {
  isValidSegment
};
