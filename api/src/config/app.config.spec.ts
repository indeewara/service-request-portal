import { validateEnv } from './app.config.js';

const required = {
  DATABASE_URL: 'postgres://portal:portal@localhost:5432/portal',
  JWT_SECRET: 'test-secret',
  S3_BUCKET: 'photos',
};

describe('validateEnv', () => {
  it('applies defaults and turns numbers into numbers', () => {
    const config = validateEnv({ ...required, LOGIN_RATE_LIMIT: '7' });
    expect(config).toMatchObject({
      PORT: 4000,
      LOGIN_RATE_LIMIT: 7,
      TRUST_PROXY_HOPS: 0,
      REDIS_URL: 'redis://localhost:6379',
      LOG_LEVEL: 'info',
    });
    expect(config.S3_ENDPOINT).toBeUndefined();
  });

  it('keeps only the settings it knows about', () => {
    const config = validateEnv({ ...required, PATH: '/usr/bin', HOME: '/home/x' });
    expect(config).not.toHaveProperty('PATH');
    expect(config).not.toHaveProperty('HOME');
  });

  it('names every missing required setting in one error', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL.*JWT_SECRET.*S3_BUCKET/);
  });

  it('rejects invalid values', () => {
    const bad = { ...required, LOG_LEVEL: 'loud', MOCK_EMAIL_FAILURE_RATE: '2', PORT: 'abc' };
    expect(() => validateEnv(bad)).toThrow(/PORT/);
    expect(() => validateEnv(bad)).toThrow(/MOCK_EMAIL_FAILURE_RATE/);
    expect(() => validateEnv(bad)).toThrow(/LOG_LEVEL/);
  });
});
