import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Files share one database and each app boot runs migrations; run them one at a time.
    fileParallelism: false,
    // Tests log in often; the rate-limit test lowers this itself.
    env: { LOGIN_RATE_LIMIT: '1000' },
  },
});
