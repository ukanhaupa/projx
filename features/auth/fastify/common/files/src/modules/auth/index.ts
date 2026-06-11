export { default as authRoutes } from "./routes.js";
export {
  cleanupAuthArtifacts,
  sendInitialVerificationEmail,
  startVerificationJobs,
} from "./verification-jobs.js";
export { initMailer, SMTP_PURPOSE } from "./mailer.js";
