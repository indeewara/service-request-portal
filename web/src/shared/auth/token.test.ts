import { canOpen, safeNext } from './token';

describe('canOpen (which role may open a page)', () => {
  it('keeps staff pages for staff', () => {
    expect(canOpen('STAFF', '/staff')).toBe(true);
    expect(canOpen('STAFF', '/staff/requests/1?x=1')).toBe(true);
    expect(canOpen('CUSTOMER', '/staff')).toBe(false);
    expect(canOpen('CUSTOMER', '/staff?status=NEW')).toBe(false);
  });

  it('keeps customer pages for customers', () => {
    expect(canOpen('CUSTOMER', '/requests/new')).toBe(true);
    expect(canOpen('STAFF', '/requests')).toBe(false);
    expect(canOpen('STAFF', '/requests/123')).toBe(false);
  });

  it('matches whole sections only, and leaves other pages open', () => {
    expect(canOpen('CUSTOMER', '/staffing')).toBe(true);
    expect(canOpen('STAFF', '/help')).toBe(true);
    expect(canOpen('CUSTOMER', '/help')).toBe(true);
  });
});

describe('safeNext (where to go after login)', () => {
  it('keeps a path on this site, with its query string', () => {
    expect(safeNext('/requests/123')).toBe('/requests/123');
    expect(safeNext('/staff?status=NEW&page=2')).toBe('/staff?status=NEW&page=2');
  });

  it('ignores a missing value', () => {
    expect(safeNext(undefined)).toBeUndefined();
    expect(safeNext('')).toBeUndefined();
  });

  it.each([
    ['a full URL', 'https://evil.example/login'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash, which browsers treat as a slash', '/\\evil.example'],
    ['a tab hidden between the slashes', '/\t/evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('rejects %s', (_, next) => {
    expect(safeNext(next)).toBeUndefined();
  });
});
