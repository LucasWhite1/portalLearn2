require('./loadEnv');
const { validateSecurityConfiguration } = require('./configValidation');
validateSecurityConfiguration();
const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API de cursos rodando na porta ${PORT}`);
});
