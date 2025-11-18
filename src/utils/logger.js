export function logInfo(message, meta = {}) {
  console.log(`[INFO] ${message}`, Object.keys(meta).length ? meta : '');
}

export function logError(message, error) {
  console.error(`[ERROR] ${message}`, error);
}

export function logDebug(message, meta = {}) {
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[DEBUG] ${message}`, Object.keys(meta).length ? meta : '');
  }
}
