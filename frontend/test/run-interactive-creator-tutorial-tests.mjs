import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(dirname, '../../template-store/1tutorial-completo-do-interactive-creator.json');
const payload = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const builderData = payload?.template?.builderData;
const slides = builderData?.slides || [];

assert.equal(payload.kind, 'curso-slide-template');
assert.equal(payload.template.title, 'Tutorial Completo do Interactive Creator');
assert.equal(slides.length, 28);
assert.deepEqual(builderData.stageSize, { width: 1280, height: 720 });

const requiredElementTypes = [
  'text', 'block', 'image', 'audio', 'video', 'camera', 'quiz', 'pen', 'input',
  'floatingButton', 'key', 'detector', 'timedTrigger', 'animatedArrow'
];
const elementTypes = new Set(slides.flatMap((slide) => (slide.elements || []).map((element) => element.type)));
requiredElementTypes.forEach((type) => assert.ok(elementTypes.has(type), `Elemento ausente no tutorial: ${type}`));

const requiredCoverage = [
  'dados-do-modulo', 'loja-de-templates', 'fundo-em-lote', 'camadas', 'borracha',
  'gatilhos-de-video', 'acao-alternar-gatilho', '3d-ativar-catalogo-busca-primitivas-importar-biblioteca-excluir-controle-posicao-animacao-reset-fixar',
  'ia-prompt-imagem-planejar-aplicar-descartar-selecao-creditos',
  'seguranca-travar-proximo-quiz-obrigatorio-link-publico-caneta-aluno-reconhecimento-facial',
  'aula-ao-vivo-iniciar-publicar-manual-camera-tela-cursores-link', 'concluir-e-publicar'
];
const coverage = new Set(builderData.tutorialCoverage || []);
requiredCoverage.forEach((item) => assert.ok(coverage.has(item), `Cobertura ausente: ${item}`));

const slideIds = new Set();
const allElementIds = new Set();
const allTriggerIds = new Set();
slides.forEach((slide) => {
  assert.ok(!slideIds.has(slide.id), `Slide duplicado: ${slide.id}`);
  slideIds.add(slide.id);
  const localElementIds = new Set();
  const localTriggerIds = new Set();
  (slide.elements || []).forEach((element) => {
    assert.ok(!allElementIds.has(element.id), `Elemento duplicado: ${element.id}`);
    allElementIds.add(element.id);
    localElementIds.add(element.id);
    assert.ok(element.x >= 0 && element.y >= 0, `Elemento com posição negativa: ${element.id}`);
    assert.ok(element.x + element.width <= 1280, `Elemento ultrapassa a largura: ${element.id}`);
    assert.ok(element.y + element.height <= 720, `Elemento ultrapassa a altura: ${element.id}`);
    [...(element.interactionTriggers || []), ...(element.videoTriggers || [])].forEach((trigger) => {
      assert.ok(!allTriggerIds.has(trigger.id), `Gatilho duplicado: ${trigger.id}`);
      allTriggerIds.add(trigger.id);
      localTriggerIds.add(trigger.id);
    });
  });
  (slide.elements || []).forEach((element) => {
    [...(element.interactionTriggers || []), ...(element.videoTriggers || [])].forEach((trigger) => {
      const config = trigger.actionConfig || {};
      if (config.targetElementId) assert.ok(localElementIds.has(config.targetElementId), `Alvo fora do slide: ${config.targetElementId}`);
      if (config.targetTriggerId) assert.ok(localTriggerIds.has(config.targetTriggerId), `Gatilho alvo fora do slide: ${config.targetTriggerId}`);
    });
  });
});

slides.forEach((slide, index) => {
  if (index < 2) return;
  assert.ok(slide.elements.some((element) => element.id === `${slide.id}-back`), `Voltar ausente: ${slide.id}`);
  assert.ok(slide.elements.some((element) => element.id === `${slide.id}-next`), `Continuar ausente: ${slide.id}`);
});

const quizSlide = slides.find((slide) => slide.id === 'tutorial-15-quiz');
const quiz = quizSlide.elements.find((element) => element.id === 'quiz-demo');
assert.deepEqual(new Set(quiz.interactionTriggers.map((trigger) => trigger.quizResult)), new Set(['correct', 'wrong']));

const toggleSlide = slides.find((slide) => slide.id === 'tutorial-17-gatilhos');
const toggleAction = toggleSlide.elements
  .flatMap((element) => element.interactionTriggers || [])
  .find((trigger) => trigger.actionConfig?.type === 'toggleTrigger');
assert.equal(toggleAction.actionConfig.targetTriggerId, 'toggle-target-trigger');

const threeDSlide = slides.find((slide) => slide.id === 'tutorial-23-3d');
assert.equal(threeDSlide.threeDScene?.enabled, true);
assert.ok(threeDSlide.elements.some((element) => element.attachment3d?.enabled));

console.log(`interactive creator tutorial tests: ok (${slides.length} slides, ${allElementIds.size} elements, ${coverage.size} coverage items)`);
