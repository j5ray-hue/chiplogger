module.exports = function getAppOrigin(requestLike, fallbackOrigin = "https://chiplogger.com") {
  try {
    const headers = requestLike?.headers || {};
    const host = headers["x-forwarded-host"] || headers["cf-connecting-host"] || headers.host || headers.Host || "chiplogger.com";
    const proto = headers["x-forwarded-proto"] || "https";
    const requestUrl = requestLike?.rawUrl || requestLike?.url || `${proto}://${host}`;
    return new URL(requestUrl).origin;
  } catch (_) {
    return fallbackOrigin;
  }
};
