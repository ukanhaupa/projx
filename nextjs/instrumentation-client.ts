import { initSentry } from './src/lib/sentry';

initSentry();

export { captureRouterTransitionStart as onRouterTransitionStart } from '@sentry/nextjs';
