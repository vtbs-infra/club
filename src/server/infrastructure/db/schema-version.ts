export const EXPECTED_SCHEMA_MIGRATIONS = [
  {
    createdAt: '1789090393347',
    hash: '3c090e292d580745eb1024c1417676c44c84fbe40ee3c4a86724e958031a4355',
    tag: '0000_username_uid_baseline',
  },
  {
    createdAt: '1789116432107',
    hash: '826ef40a9ffeff55ee275c72a0793d48b51a9b124a5780f281b55cdf74c7ca90',
    tag: '0001_identity_challenge_capacity',
  },
  {
    createdAt: '1789155974775',
    hash: 'e4a2cc0b44e794fca66359aae29459154eb867f48ff22486b428e04cd8886075',
    tag: '0002_bilibili_managed_session',
  },
] as const;
