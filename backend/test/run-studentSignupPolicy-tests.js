const assert = require('assert');
const { shouldAutoApproveSignup, canApproveStudent } = require('../src/studentSignupPolicy');

assert.equal(shouldAutoApproveSignup({ autoApprove: true, limitReached: false }), true);
assert.equal(shouldAutoApproveSignup({ autoApprove: true, limitReached: true }), false);
assert.equal(shouldAutoApproveSignup({ autoApprove: false, limitReached: false }), false);
assert.equal(shouldAutoApproveSignup({ autoApprove: true, limitReached: false, professorActive: false }), false);

assert.equal(canApproveStudent({ professorRole: 'professor', studentLimit: 15, activeStudents: 14 }), true);
assert.equal(canApproveStudent({ professorRole: 'professor', studentLimit: 15, activeStudents: 15 }), false);
assert.equal(canApproveStudent({ professorRole: 'professor', studentLimit: null, activeStudents: 100 }), true);
assert.equal(canApproveStudent({ professorRole: 'admin', studentLimit: 1, activeStudents: 1 }), true);
assert.equal(canApproveStudent({ professorRole: 'professor', studentLimit: 1, activeStudents: 1, alreadyActive: true }), true);

console.log('Student signup policy tests passed.');
