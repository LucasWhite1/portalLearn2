require('./loadEnv');
const { validateSecurityConfiguration } = require('./configValidation');
validateSecurityConfiguration();
const app = require('./app');
const { cleanupExpiredBiometricData } = require('./faceVerification');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API de cursos rodando na porta ${PORT}`);
});

const biometricCleanupTimer = setInterval(() => {
  cleanupExpiredBiometricData().catch((error) => {
    console.error('Falha ao limpar dados biometricos expirados:', error.message);
  });
}, 60 * 60 * 1000);
biometricCleanupTimer.unref();
