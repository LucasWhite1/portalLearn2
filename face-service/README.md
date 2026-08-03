# Servico interno de verificacao facial

Este container nao deve receber dominio publico. O backend Express e o unico cliente permitido e autentica as chamadas com `FACE_SERVICE_INTERNAL_TOKEN`.

## Variaveis obrigatorias

- `FACE_SERVICE_INTERNAL_TOKEN`: segredo aleatorio compartilhado somente entre o backend e este servico.
- `FACE_MODEL_VERSION`: versao registrada junto ao vetor facial (atual: `opencv-sface-2021dec-mediapipe-v2`).
- `FACE_COSINE_THRESHOLD`: similaridade cosseno minima por quadro (padrao `0.55`).
- `FACE_MATCH_CONSENSUS_RATIO`: proporcao minima de quadros aprovados (padrao `0.75`).
- `FACE_MIN_MATCH_FRAMES`: quantidade minima de vetores validos na comparacao (padrao `6`).
- `FACE_MAX_EMBEDDING_FRAMES`: limite de quadros distribuidos analisados por captura (padrao `12`).
- `BIOMETRIC_DATA_KEY`: configurada apenas no backend; use 32 bytes em hexadecimal ou base64.
- `FACE_SERVICE_URL`: URL interna usada pelo backend, por exemplo `http://face-verification:8081`.

Gere os segredos separadamente:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No Easypanel, crie este diretorio como um segundo servico usando `face-service/Dockerfile`, sem porta ou dominio publico. Conecte os dois servicos na mesma rede interna e configure `FACE_SERVICE_URL` com o hostname interno atribuido ao servico.

Os modelos YuNet e SFace sao baixados de uma versao fixa do OpenCV Zoo durante o build e validados por SHA-256. Antes de disponibilizar o recurso em producao, execute a revisao juridica e o RIPD previstos para dados biometricos.
