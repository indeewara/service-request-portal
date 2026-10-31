import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';
import { AuthUser, Role } from './auth.types.js';
import { Public, Roles } from './decorators.js';

const jwt = new JwtService({ secret: 'test-secret' });
const guard = new AuthGuard(new Reflector(), jwt);

function contextFor(
  authorization?: string,
  decorate?: (handler: () => void) => void,
) {
  const handler = () => {};
  decorate?.(handler);
  const req: { headers: Record<string, string>; user?: AuthUser } = {
    headers: authorization ? { authorization } : {},
  };
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

const tokenFor = (role: Role) => `Bearer ${jwt.sign({ sub: 'user-1', role })}`;

describe('AuthGuard', () => {
  it('lets @Public() routes through without a token', async () => {
    const { context } = contextFor(undefined, (h) => Public()(h));
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a missing token', async () => {
    await expect(guard.canActivate(contextFor().context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-Bearer scheme', async () => {
    const { context } = contextFor('Basic abc');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with another secret', async () => {
    const forged = new JwtService({ secret: 'other' }).sign({
      sub: 'user-1',
      role: Role.STAFF,
    });
    const { context } = contextFor(`Bearer ${forged}`);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: 'user-1', role: Role.STAFF },
      { expiresIn: -10 },
    );
    const { context } = contextFor(`Bearer ${expired}`);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unsigned token (alg: none) claiming STAFF', async () => {
    const part = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'user-1', role: Role.STAFF })}.`;
    const { context } = contextFor(`Bearer ${unsigned}`);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the caller to the request for a valid token', async () => {
    const { context, req } = contextFor(tokenFor(Role.CUSTOMER));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'user-1', role: Role.CUSTOMER });
  });

  it('forbids a customer on a staff-only route', async () => {
    const { context } = contextFor(tokenFor(Role.CUSTOMER), (h) =>
      Roles(Role.STAFF)(h),
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows staff on a staff-only route', async () => {
    const { context } = contextFor(tokenFor(Role.STAFF), (h) =>
      Roles(Role.STAFF)(h),
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
