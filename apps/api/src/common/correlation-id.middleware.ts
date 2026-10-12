import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(HEADER);
  req.correlationId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.correlationId);
  next();
}
