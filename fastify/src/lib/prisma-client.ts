import { PrismaClient } from '@prisma/client';

const APPLICATION_NAME = 'projx-fastify';
const TIMEOUT = Number(process.env.DB_STATEMENT_TIMEOUT ?? '5');

function augmentUrl(raw: string): string {
  const timeoutMs = TIMEOUT * 1000;
  const url = new URL(raw);
  if (!url.searchParams.has('application_name')) {
    url.searchParams.set('application_name', APPLICATION_NAME);
  }
  const existing = url.searchParams.get('options') ?? '';
  const extras: string[] = [];
  if (!/statement_timeout/.test(existing)) {
    extras.push(`-c statement_timeout=${timeoutMs}`);
  }
  if (!/idle_in_transaction_session_timeout/.test(existing)) {
    extras.push(`-c idle_in_transaction_session_timeout=${timeoutMs * 2}`);
  }
  if (extras.length) {
    const merged = [existing, ...extras].filter(Boolean).join(' ');
    url.searchParams.set('options', merged);
  }
  return url.toString();
}

function buildClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is not set. ' +
        'Please configure the database connection string.',
    );
  }
  const timeoutMs = TIMEOUT * 1000;
  return new PrismaClient({
    transactionOptions: { maxWait: timeoutMs, timeout: timeoutMs * 2 },
    datasourceUrl: augmentUrl(url),
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
    ],
  });
}

let _client: ReturnType<typeof buildClient> | null = null;

export function getPrismaClient(): ReturnType<typeof buildClient> {
  if (!_client) _client = buildClient();
  return _client;
}

export async function disposePrismaClient(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
