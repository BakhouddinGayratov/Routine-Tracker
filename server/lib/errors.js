/** An error that is safe to show to the client, carrying an HTTP status. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  static badRequest(message = 'Invalid request', details) { return new ApiError(400, message, details); }
  static unauthorized(message = 'Authentication required') { return new ApiError(401, message); }
  static forbidden(message = 'Not allowed') { return new ApiError(403, message); }
  static notFound(message = 'Not found') { return new ApiError(404, message); }
  static conflict(message = 'Already exists') { return new ApiError(409, message); }
  static tooMany(message = 'Too many requests') { return new ApiError(429, message); }
}
