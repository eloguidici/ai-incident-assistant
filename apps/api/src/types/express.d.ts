import 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      user?: { id: string; email: string };
    }
  }
}

export {};
