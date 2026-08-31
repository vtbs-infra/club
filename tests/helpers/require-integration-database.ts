export default function requireIntegrationDatabase(): void {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests.');
  }
}
