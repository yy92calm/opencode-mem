import { writeObservation, writeSessionSummary, updateIndex, listObservations, listSessions, ensureMemDirs } from '../src/storage/markdown.js';
import { searchMemories } from '../src/search/search.js';
import { buildContext } from '../src/context/inject.js';
import { rmSync, existsSync, readFileSync } from 'fs';

const TEST_DIR = '/tmp/opencode-mem-test';

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

function setup() {
  cleanup();
  ensureMemDirs(TEST_DIR, { memDir: TEST_DIR });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function testWriteObservation() {
  console.log('\n📝 Test: Write Observation');

  const result = writeObservation(TEST_DIR, {
    type: 'bugfix',
    title: 'JWT Expiration Bug',
    subtitle: 'Fixed token validation on API routes',
    narrative: 'The JWT middleware was not checking the exp claim on incoming tokens.',
    facts: ['Token validation missing exp check', 'Affected all API routes'],
    concepts: ['authentication', 'jwt'],
    filesRead: ['packages/auth/jwt.ts'],
    filesModified: ['packages/auth/jwt.ts', 'packages/api/middleware.ts'],
    sessionId: 'test-session-001',
    timestamp: new Date().toISOString(),
  }, { memDir: TEST_DIR });

  assert(result.id === 1, `Observation ID should be 1, got ${result.id}`);
  assert(result.filepath.includes('0001'), `File should contain padded ID`);
  assert(existsSync(result.filepath), `File should exist at ${result.filepath}`);

  const result2 = writeObservation(TEST_DIR, {
    type: 'decision',
    title: 'Use Zod for Validation',
    subtitle: 'Chose Zod over Joi for schema validation',
    narrative: 'After comparing Zod and Joi, we chose Zod because of better TypeScript support.',
    facts: ['Zod has better TypeScript support'],
    concepts: ['validation', 'types'],
    filesRead: [],
    filesModified: ['packages/validation/schema.ts'],
    sessionId: 'test-session-001',
    timestamp: new Date().toISOString(),
  }, { memDir: TEST_DIR });

  assert(result2.id === 2, `Second observation ID should be 2, got ${result2.id}`);

  const result3 = writeObservation(TEST_DIR, {
    type: 'feature',
    title: 'Add User Authentication',
    subtitle: 'Implemented login and logout endpoints',
    narrative: 'Added JWT-based authentication with login/logout endpoints.',
    facts: ['Uses JWT for session management'],
    concepts: ['authentication', 'api'],
    filesRead: ['packages/auth/jwt.ts'],
    filesModified: ['packages/api/routes/auth.ts'],
    sessionId: 'test-session-002',
    timestamp: new Date().toISOString(),
  }, { memDir: TEST_DIR });

  assert(result3.id === 3, `Third observation ID should be 3, got ${result3.id}`);
}

async function testWriteSessionSummary() {
  console.log('\n📋 Test: Write Session Summary');

  const result = writeSessionSummary(TEST_DIR, {
    sessionId: 'test-session-001',
    project: 'test-project',
    request: 'Fix authentication bugs',
    investigated: 'JWT middleware, token validation',
    learned: 'Token expiration was not being checked',
    completed: 'Fixed JWT middleware to check exp claim',
    nextSteps: 'Add refresh token support',
    filesRead: ['packages/auth/jwt.ts'],
    filesEdited: ['packages/auth/jwt.ts', 'packages/api/middleware.ts'],
    timestamp: new Date().toISOString(),
  }, { memDir: TEST_DIR });

  assert(existsSync(result.filepath), `Session summary file should exist`);
}

async function testListObservations() {
  console.log('\n📚 Test: List Observations');

  const observations = listObservations(TEST_DIR, { memDir: TEST_DIR });
  assert(observations.length === 3, `Should have 3 observations, got ${observations.length}`);
  assert(observations[0].type === 'bugfix', `First observation should be bugfix`);
  assert(observations[2].type === 'feature', `Third observation should be feature`);
}

async function testListSessions() {
  console.log('\n📊 Test: List Sessions');

  const sessions = listSessions(TEST_DIR, { memDir: TEST_DIR });
  assert(sessions.length === 1, `Should have 1 session, got ${sessions.length}`);
  assert(sessions[0].request.includes('Fix authentication bugs'), `Session request should match`);
}

async function testSearch() {
  console.log('\n🔍 Test: Search');

  const results = searchMemories(TEST_DIR, 'authentication', { memDir: TEST_DIR });
  assert(results.length > 0, `Should find results for "authentication"`);

  const jwtResults = searchMemories(TEST_DIR, 'jwt', { memDir: TEST_DIR });
  assert(jwtResults.length > 0, `Should find results for "jwt"`);

  const bugfixResults = searchMemories(TEST_DIR, 'bug', { type: 'bugfix', memDir: TEST_DIR });
  assert(bugfixResults.length > 0, `Should find bugfix results for "bug"`);

  const noResults = searchMemories(TEST_DIR, 'nonexistent_keyword_xyz', { memDir: TEST_DIR });
  assert(noResults.length === 0, `Should find no results for nonexistent keyword`);
}

async function testContext() {
  console.log('\n🧠 Test: Build Context');

  const context = buildContext(TEST_DIR, { memDir: TEST_DIR });
  assert(context !== null, `Context should not be null`);
  assert(context!.includes('Recent Observations'), `Context should include Recent Observations section`);
  assert(context!.includes('JWT Expiration Bug'), `Context should include observation title`);
  assert(context!.includes('Recent Sessions'), `Context should include Recent Sessions section`);
}

async function testIndex() {
  console.log('\n📑 Test: Update Index');

  updateIndex(TEST_DIR, { memDir: TEST_DIR });
  const indexFile = `${TEST_DIR}/INDEX.md`;
  assert(existsSync(indexFile), `INDEX.md should exist`);

  const indexContent = readFileSync(indexFile, 'utf-8');
  assert(indexContent.includes('Total Observations'), `Index should show total observations count`);
  assert(indexContent.includes('bugfix'), `Index should include bugfix type`);
  assert(indexContent.includes('decision'), `Index should include decision type`);
  assert(indexContent.includes('feature'), `Index should include feature type`);
}

async function runTests() {
  console.log('🧪 Running opencode-mem tests...\n');
  console.log(`Test directory: ${TEST_DIR}`);

  setup();

  try {
    await testWriteObservation();
    await testWriteSessionSummary();
    await testListObservations();
    await testListSessions();
    await testSearch();
    await testContext();
    await testIndex();
  } catch (error) {
    console.error(`\n❌ Test failed with error: ${error}`);
    failed++;
  }

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(40)}`);

  if (failed > 0) {
    console.log(`\nTest directory preserved for debugging: ${TEST_DIR}`);
  } else {
    cleanup();
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
