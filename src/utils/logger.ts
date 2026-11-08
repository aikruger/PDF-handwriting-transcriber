export const Logger = {
  log: (context: string, message: string, data?: Record<string, unknown>) => {
    console.log(`[PDFTranscriber][${context}] ${message}`, data ? sanitizeLogData(data) : '');
  },
  warn: (context: string, message: string, data?: Record<string, unknown>) => {
    console.warn(`[PDFTranscriber][${context}] ${message}`, data ? sanitizeLogData(data) : '');
  },
  error: (context: string, message: string, data?: Record<string, unknown>) => {
    console.error(`[PDFTranscriber][${context}] ${message}`, data ? sanitizeLogData(data) : '');
  },
  debug: (context: string, message: string, data?: Record<string, unknown>) => {
    // Debug could be gated behind a setting, but for now we just use console.debug
    console.debug(`[PDFTranscriber][${context}] ${message}`, data ? sanitizeLogData(data) : '');
  }
};

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };

  const sensitiveKeys = ['apiKey', 'authorization', 'token', 'credentials', 'password'];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
    if (key === 'imageDataUrl' || key === 'base64') {
      sanitized[key] = '[BASE64_IMAGE_DATA]';
    }
    if (key === 'prompt' || key === 'text' || key === 'transcript' || key === 'content') {
      const val = sanitized[key];
      if (typeof val === 'string' && val.length > 50) {
        sanitized[key] = val.substring(0, 50) + '... [TRUNCATED]';
      }
    }
    // Also block error bodies if they might contain full unsanitised responses
    if (key === 'responseBody' || key === 'errorBody') {
      sanitized[key] = '[REDACTED_ERROR_BODY]';
    }
  }
  return sanitized;
}
