import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { AttachmentsController } from '../attachments/attachments.controller.js';
import { HealthController } from '../health/health.controller.js';
import { RequestsController } from '../requests/requests.controller.js';
import { AuthController } from './auth.controller.js';
import { IS_PUBLIC, ROLES } from './decorators.js';

// Who may call each route, as the AuthGuard reads it. Per-request ownership
// (customers only see their own requests) is tested in request-access.spec.ts.
// A new route fails this test until someone decides its access here.
const EXPECTED = {
  'POST /auth/login': 'public',
  'GET /health': 'public',
  'POST /requests': 'CUSTOMER',
  'GET /requests/mine': 'CUSTOMER',
  'GET /requests': 'STAFF',
  'GET /requests/:id': 'any signed-in user',
  'PATCH /requests/:id/status': 'STAFF',
  'GET /requests/:id/events': 'any signed-in user',
  'POST /requests/:id/attachments/upload-url': 'CUSTOMER',
  'POST /requests/:id/attachments/:attachmentId/complete': 'CUSTOMER',
  'GET /requests/:id/attachments': 'any signed-in user',
};

function actualAccess() {
  const reflector = new Reflector();
  const routes: Record<string, string> = {};
  for (const controller of [
    AuthController,
    HealthController,
    RequestsController,
    AttachmentsController,
  ]) {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
    const proto = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name];
      if (
        typeof handler !== 'function' ||
        !Reflect.hasMetadata(PATH_METADATA, handler)
      )
        continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const targets = [handler, controller];
      const roles = reflector.getAllAndOverride<string[]>(ROLES, targets);
      routes[
        `${method} /${[base, path].filter((p) => p && p !== '/').join('/')}`
      ] = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)
        ? 'public'
        : (roles?.join(', ') ?? 'any signed-in user');
    }
  }
  return routes;
}

describe('route access table', () => {
  it('matches the intended roles for every route', () => {
    expect(actualAccess()).toEqual(EXPECTED);
  });
});
