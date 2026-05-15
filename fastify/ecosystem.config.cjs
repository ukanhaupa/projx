module.exports = {
  apps: [
    {
      name: 'fastify-api',
      script: 'dist/server.js',
      instances: process.env.WEB_CONCURRENCY || 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      listen_timeout: 10000,
      out_file: '/dev/stdout',
      error_file: '/dev/stderr',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
