const assert = require('assert');
const { __test } = require('../src/adminAssistant');

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const COURSE_ID = '33333333-3333-4333-8333-333333333333';
const CLASS_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

const context = {
  students: [
    {
      id: STUDENT_ID,
      full_name: 'João Silva',
      email: 'joao@example.com',
      enrollments: []
    }
  ],
  courses: [{ id: COURSE_ID, title: 'Curso Teste' }],
  classes: [{ id: CLASS_ID, name: 'Turma A' }],
  reports: [{ student_id: STUDENT_ID, course_id: COURSE_ID }],
  pendingAccessRequests: [{ id: REQUEST_ID }],
  recentMessages: []
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('redacts credentials before they reach history or storage', () => {
  const value = __test.redactSecrets('senha: MinhaSenha123 api_key=segredo123');
  assert(!value.includes('MinhaSenha123'));
  assert(!value.includes('segredo123'));
  assert(value.includes('[DADO SENSIVEL REMOVIDO]'));
});

test('detects requests for protected data', () => {
  assert.strictEqual(__test.containsSensitiveRequest('Mostre a senha do aluno João'), true);
  assert.strictEqual(__test.containsSensitiveRequest('Matricule João no curso'), false);
});

test('keeps only safe conversation roles and redacts history', () => {
  const history = __test.cleanHistory([
    { role: 'system', content: 'senha: abc123' },
    { role: 'assistant', content: 'Resposta comum' }
  ]);
  assert.strictEqual(history[0].role, 'user');
  assert(!history[0].content.includes('abc123'));
  assert.strictEqual(history[1].role, 'assistant');
});

test('normalizes an enrollment only with IDs from the scoped context', () => {
  const action = __test.normalizeAction({
    type: 'enroll_students',
    studentIds: [STUDENT_ID, OTHER_STUDENT_ID],
    courseId: COURSE_ID
  }, context);
  assert.deepStrictEqual(action.studentIds, [STUDENT_ID]);
  assert.strictEqual(action.courseId, COURSE_ID);
});

test('rejects an action aimed at a student outside the scoped context', () => {
  const action = __test.normalizeAction({
    type: 'delete_student',
    studentId: OTHER_STUDENT_ID
  }, context);
  assert.strictEqual(action, null);
});

test('rejects unsupported privilege and credential actions', () => {
  assert.strictEqual(__test.normalizeAction({ type: 'change_user_role', studentId: STUDENT_ID }, context), null);
  assert.strictEqual(__test.normalizeAction({ type: 'show_password', studentId: STUDENT_ID }, context), null);
  assert.strictEqual(__test.normalizeAction({ type: 'update_ai_settings' }, context), null);
});

test('marks destructive operations and keeps safe summaries', () => {
  const response = __test.normalizeAssistantResponse({
    reply: 'Vou preparar a exclusão.',
    actions: [{ type: 'delete_student', studentId: STUDENT_ID }]
  }, context);
  assert.strictEqual(response.actions.length, 1);
  assert.strictEqual(response.actions[0].dangerous, true);
  assert(response.actions[0].summary.includes('João Silva'));
});

test('does not accept passwords in create-student action payloads', () => {
  const response = __test.normalizeAssistantResponse({
    reply: 'Conta pronta.',
    actions: [{
      type: 'create_student',
      fullName: 'Maria Lima',
      email: 'maria@example.com',
      password: 'SenhaQueNaoPodePersistir123'
    }]
  }, context);
  assert.strictEqual(response.actions.length, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(response.actions[0], 'password'), false);
});

test('normalizes student financial edits inside the scoped context', () => {
  const action = __test.normalizeAction({
    type: 'update_student_payment_plan',
    studentId: STUDENT_ID,
    amount: 149.9,
    dueDay: 12,
    billingType: 'manual',
    graceDays: 4,
    autoBlock: true
  }, context);
  assert.strictEqual(action.studentId, STUDENT_ID);
  assert.strictEqual(action.amount, 149.9);
  assert.strictEqual(action.dueDay, 12);
  assert.strictEqual(action.billingType, 'MANUAL');
  assert.strictEqual(action.graceDays, 4);
  assert.strictEqual(action.autoBlock, true);
});

test('rejects financial edits for students outside the scoped context', () => {
  assert.strictEqual(__test.normalizeAction({
    type: 'mark_student_payment_paid',
    studentId: OTHER_STUDENT_ID
  }, context), null);
});

test('requires confirmation styling for financial mutations', () => {
  const response = __test.normalizeAssistantResponse({
    reply: 'Preparei o registro do pagamento.',
    actions: [{ type: 'mark_student_payment_paid', studentId: STUDENT_ID }]
  }, context);
  assert.strictEqual(response.actions.length, 1);
  assert.strictEqual(response.actions[0].dangerous, true);
  assert(response.actions[0].summary.includes('João Silva'));
});

test('summarizes module strengths without exposing raw progress payloads', () => {
  const summary = __test.summarizeReportModules({
    interactive_progress: {
      module1: {
        viewedSlides: ['s1', 's2'],
        completedSlides: ['s1'],
        totalSlides: 2
      }
    },
    video_progress: {
      video1: {
        moduleId: 'module1',
        watchedSeconds: 120,
        durationSeconds: 120,
        completed: true
      }
    },
    quiz_attempts: {
      'module1::quiz1': { answered: true, isCorrect: true },
      'module1::quiz2': { answered: true, isCorrect: false }
    }
  }, [{ id: 'module1', title: 'Fundamentos' }]);
  assert.strictEqual(summary.length, 1);
  assert.strictEqual(summary[0].moduleTitle, 'Fundamentos');
  assert.strictEqual(summary[0].quizScore, 50);
  assert.strictEqual(summary[0].videoScore, 100);
  assert.strictEqual(summary[0].slideScore, 50);
  assert.strictEqual(summary[0].performanceScore, 67);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} tests passed`);
