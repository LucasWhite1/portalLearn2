const db = require('./db');

let schemaReady = false;
let schemaPromise = null;

const ensureStudentProfessorLinksSchema = async () => {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS professor_students (
        professor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_name TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        source TEXT NOT NULL DEFAULT 'legacy',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (professor_user_id, student_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_professor_students_student
        ON professor_students(student_user_id, active, professor_user_id);

      INSERT INTO professor_students (
        professor_user_id, student_user_id, class_name, active, source, approved_at
      )
      SELECT owner_user_id, id, class_name, is_active, 'legacy-owner', created_at
        FROM users
       WHERE role = 'student' AND owner_user_id IS NOT NULL
      ON CONFLICT (professor_user_id, student_user_id) DO NOTHING;
    `).then(() => {
      schemaReady = true;
    }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
};

const linkStudentToProfessor = async (client, {
  professorId,
  studentId,
  className = 'Turma A',
  source = 'course-store'
}) => {
  await ensureStudentProfessorLinksSchema();
  const executor = client || db;
  const { rows } = await executor.query(
    `INSERT INTO professor_students (
       professor_user_id, student_user_id, class_name, active, source, approved_at
     ) VALUES ($1, $2, $3, TRUE, $4, NOW())
     ON CONFLICT (professor_user_id, student_user_id) DO UPDATE SET
       active = TRUE,
       class_name = COALESCE(professor_students.class_name, EXCLUDED.class_name),
       source = EXCLUDED.source,
       approved_at = COALESCE(professor_students.approved_at, NOW()),
       updated_at = NOW()
     RETURNING *`,
    [professorId, studentId, className || 'Turma A', source]
  );
  return rows[0] || null;
};

const professorHasStudent = async (professorId, studentId, { activeOnly = false } = {}) => {
  await ensureStudentProfessorLinksSchema();
  const { rows } = await db.query(
    `SELECT 1
       FROM professor_students
      WHERE professor_user_id = $1
        AND student_user_id = $2
        ${activeOnly ? 'AND active = TRUE' : ''}`,
    [professorId, studentId]
  );
  return rows.length > 0;
};

const countProfessorStudents = async (professorId, client = db) => {
  await ensureStudentProfessorLinksSchema();
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total
       FROM professor_students
      WHERE professor_user_id = $1 AND active = TRUE`,
    [professorId]
  );
  return Number(rows[0]?.total || 0);
};

module.exports = {
  countProfessorStudents,
  ensureStudentProfessorLinksSchema,
  linkStudentToProfessor,
  professorHasStudent
};
