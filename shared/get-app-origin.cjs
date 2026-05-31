module.exports = function getAppOrigin(requestLike, fallbackOrigin = "https://chiplogger.com") {
  try {
    const requestUrl = requestLike?.rawUrl || requestLike?.url || `https://${requestLike?.headers?.host || requestLike?.headers?.Host || "chiplogger.com"}`;
    return new URL(requestUrl).origin;
  } catch (_) {
    return fallbackOrigin;
  }
};
