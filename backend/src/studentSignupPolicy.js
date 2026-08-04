const shouldAutoApproveSignup = ({ autoApprove, limitReached, professorActive = true }) => (
  professorActive === true && autoApprove === true && limitReached !== true
);

const canApproveStudent = ({ professorRole, studentLimit, activeStudents, alreadyActive = false }) => {
  if (alreadyActive || professorRole !== 'professor') return true;
  const limit = Number(studentLimit || 0);
  return limit < 1 || Number(activeStudents || 0) < limit;
};

module.exports = { shouldAutoApproveSignup, canApproveStudent };
