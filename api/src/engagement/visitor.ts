import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { createHash } from 'crypto';

const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Readers are anonymous: the browser keeps a random id and sends it as X-Visitor-Id.
 * Only a salted hash is stored, so the database never holds anything that identifies
 * a person or a device. It is enough to stop double votes, not to stop a determined
 * cheat; the rate limiter and community reports handle abuse.
 */
export function hashVisitor(raw: string | undefined): string | null {
  if (!raw || !VISITOR_ID.test(raw)) return null;
  const salt = process.env.VISITOR_SALT ?? 'nazariya-dev-salt';
  return createHash('sha256').update(`${salt}:${raw}`).digest('hex').slice(0, 32);
}

/** The hashed visitor id; `required` rejects requests without a valid X-Visitor-Id. */
export const Visitor = createParamDecorator((required: boolean | undefined, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
  const hashed = hashVisitor(req.headers['x-visitor-id']);
  if (!hashed && required !== false) throw new BadRequestException('Missing or invalid X-Visitor-Id header');
  return hashed;
});
