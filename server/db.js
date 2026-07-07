// db.js
// Simple JSON-file database using lowdb.
// Good for one teacher + a class/department of students.
// File lives at server/data/db.json - back this up regularly!

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const file = path.join(dataDir, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, {
  students: [],      // { id, email, name, createdAt }
  teachers: [],       // { id, email, name }
  otps: [],            // { id, email, code, expiresAt, purpose: 'student'|'teacher' }
  quizSets: [],        // { id, title, questions: [{id, text, options?}], createdAt, isActive }
  attempts: [],        // { id, studentId, quizSetId, questionOrder: [questionId...], answers: {questionId: answerText}, tabSwitchCount, status: 'in_progress'|'submitted'|'auto_submitted', startedAt, submittedAt }
});

async function initDb() {
  await db.read();
  db.data ||= { students: [], teachers: [], otps: [], quizSets: [], attempts: [] };
  await db.write();
  return db;
}

module.exports = { db, initDb };
