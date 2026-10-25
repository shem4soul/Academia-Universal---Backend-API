/** Error with an HTTP status. Thrown from services and turned into a JSON response by the error middleware. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  static badRequest(msg = 'Bad request', details?: unknown) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Please sign in') {
    return new ApiError(401, msg);
  }
  static paymentRequired(msg = 'Payment required', details?: unknown) {
    return new ApiError(402, msg, details);
  }
  static forbidden(msg = 'You do not have access to this resource') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Not found') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Conflict') {
    return new ApiError(409, msg);
  }
  static tooMany(msg = 'Too many requests. Please slow down.') {
    return new ApiError(429, msg);
  }
  /** An upstream service (e.g. Paystack) failed or is unreachable. */
  static badGateway(msg = 'A payment service is temporarily unavailable. Please try again.', details?: unknown) {
    return new ApiError(502, msg, details);
  }
  static unavailable(msg = 'This feature is not configured yet') {
    return new ApiError(503, msg);
  }
}
