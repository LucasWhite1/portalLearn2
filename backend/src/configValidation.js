const PLACEHOLDER_PATTERN = /troque|coloque|change-me|curso-platform-secret/i;

function validateProductionUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function validateSecurityConfiguration() {
  const isProduction = ['production', 'prod'].includes(
    String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase()
  );
  const errors = [];
  const warnings = [];
  const requireStrongSecret = (name, minimumLength = 32) => {
    const value = String(process.env[name] || '');
    if (value.length < minimumLength || PLACEHOLDER_PATTERN.test(value)) {
      errors.push(`${name} precisa ter pelo menos ${minimumLength} caracteres aleatorios.`);
    }
  };

  if (isProduction) {
    requireStrongSecret('SESSION_SECRET');
    requireStrongSecret('AI_CONFIG_SECRET');
    requireStrongSecret('ASAAS_WEBHOOK_AUTH_TOKEN');
    if (!validateProductionUrl(process.env.PUBLIC_APP_URL)) {
      errors.push('PUBLIC_APP_URL precisa ser uma URL HTTPS publica em producao.');
    }
    const asaasEnvironment = String(process.env.ASAAS_ENV || '').toLowerCase();
    if (!['sandbox', 'production'].includes(asaasEnvironment)) {
      errors.push('ASAAS_ENV precisa ser sandbox ou production.');
    }
    const asaasApiKey = String(process.env.ASAAS_API_KEY || '');
    if (!asaasApiKey || PLACEHOLDER_PATTERN.test(asaasApiKey)) {
      errors.push('ASAAS_API_KEY de producao nao foi configurada.');
    }
    if (asaasEnvironment === 'production' && /hmlg|sandbox/i.test(asaasApiKey)) {
      errors.push('ASAAS_API_KEY parece pertencer ao sandbox, mas o servidor esta em producao.');
    }
    if (asaasEnvironment === 'sandbox' && /aact_prod/i.test(asaasApiKey)) {
      errors.push('ASAAS_API_KEY parece ser de producao, mas ASAAS_ENV esta como sandbox.');
    }
    if (!Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10)) {
      warnings.push('Defina TRUST_PROXY_HOPS=1 no EasyPanel para IP real, rate limit e HSTS funcionarem corretamente.');
    }
    const enforceWebhookIp = String(process.env.ASAAS_WEBHOOK_ENFORCE_SOURCE_IP || '').toLowerCase() === 'true';
    const webhookAllowedIps = String(process.env.ASAAS_WEBHOOK_ALLOWED_IPS || '').trim();
    if (enforceWebhookIp && !webhookAllowedIps) {
      warnings.push('ASAAS_WEBHOOK_ENFORCE_SOURCE_IP=true sem ASAAS_WEBHOOK_ALLOWED_IPS pode bloquear webhooks legitimos atras de proxy.');
    }
  }

  warnings.forEach((warning) => console.warn(`[security] ${warning}`));
  if (errors.length) {
    throw new Error(`Configuracao insegura:\n- ${errors.join('\n- ')}`);
  }
}

module.exports = { validateSecurityConfiguration };
