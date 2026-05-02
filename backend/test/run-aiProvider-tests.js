const assert = require('node:assert/strict');

const { __test } = require('../src/aiProvider');

const tests = [
  {
    name: 'parse valid JSON array directly',
    run() {
      const parsed = __test.tryParseJsonCandidate('[{"type":"add_slide","reason":"ok"}]');
      assert.equal(Array.isArray(parsed), true);
      assert.equal(parsed[0].type, 'add_slide');
    }
  },
  {
    name: 'extract JSON array when wrapped in markdown and extra text',
    run() {
      const raw = 'Aqui vai a resposta\n```json\n[{"type":"add_slide","reason":"ok"}]\n```\nFim';
      const parsed = __test.tryParseJsonCandidate(raw);
      assert.equal(parsed[0].reason, 'ok');
    }
  },
  {
    name: 'sanitize trailing commas before object and array endings',
    run() {
      const raw = '[{"type":"add_slide","reason":"ok",},]';
      const parsed = __test.tryParseJsonCandidate(raw);
      assert.equal(parsed[0].type, 'add_slide');
    }
  },
  {
    name: 'extract balanced JSON before trailing garbage',
    run() {
      const raw = '[{"type":"add_slide","reason":"ok"}] texto solto depois';
      const parsed = __test.tryParseJsonCandidate(raw);
      assert.equal(parsed[0].type, 'add_slide');
    }
  },
  {
    name: 'parse valid step payload object',
    run() {
      const raw = '{"done":false,"message":"ok","action":{"type":"add_slide","reason":"ok"}}';
      const parsed = __test.parseStepPayload(raw);
      assert.equal(parsed.done, false);
      assert.equal(parsed.action.type, 'add_slide');
    }
  },
  {
    name: 'throw clear error for truncated unterminated string JSON',
    run() {
      const raw = '[{"type":"add_slide","reason":"texto sem fechar}]';
      assert.throws(
        () => __test.tryParseJsonCandidate(raw),
        /truncado|incompleto|Unexpected end|Unterminated/i
      );
    }
  },
  {
    name: 'truncate long text with ellipsis',
    run() {
      const parsed = __test.truncateText('abcdefghijklmnop', 10);
      assert.equal(parsed, 'abcdefg...');
    }
  },
  {
    name: 'summarize slides limits volume and label size',
    run() {
      const slides = Array.from({ length: 8 }, (_, index) => ({
        id: `slide-${index + 1}`,
        title: `Slide ${index + 1}`,
        elements: Array.from({ length: 20 }, (__unused, elementIndex) => ({
          id: `el-${index + 1}-${elementIndex + 1}`,
          type: 'text',
          content: `Elemento ${elementIndex + 1} `.repeat(20),
          x: 10,
          y: 20,
          width: 100,
          height: 40
        }))
      }));
      const summary = __test.summarizeSlides(slides);
      assert.equal(summary.totalSlides, 8);
      assert.equal(summary.includedSlides, 3);
      assert.equal(summary.slides[0].elements.length, 6);
      assert.ok(summary.slides[0].elements[0].label.length <= 48);
    }
  },
  {
    name: 'apply planning actions updates draft state incrementally',
    run() {
      const planningState = {
        activeSlideId: 'slide-1',
        slides: [{ id: 'slide-1', title: 'Inicial', backgroundColor: '#fff', elements: [] }]
      };
      __test.applyActionToPlanningState(planningState, {
        type: 'add_slide',
        slide: { id: 'slide-2', title: 'Novo slide', backgroundColor: '#eee' },
        afterSlideId: 'slide-1',
        setActive: true
      });
      __test.applyActionToPlanningState(planningState, {
        type: 'add_element',
        slideId: 'slide-2',
        element: { id: 'el-1', type: 'text', content: 'Oi', x: 10, y: 10, width: 100, height: 40 }
      });
      __test.applyActionToPlanningState(planningState, {
        type: 'update_element',
        slideId: 'slide-2',
        elementId: 'el-1',
        element: { content: 'Atualizado', width: 120 }
      });
      assert.equal(planningState.activeSlideId, 'slide-2');
      assert.equal(planningState.slides.length, 2);
      assert.equal(planningState.slides[1].elements[0].content, 'Atualizado');
      assert.equal(planningState.slides[1].elements[0].width, 120);
    }
  },
  {
    name: 'detect recoverable JSON errors from parser and model messages',
    run() {
      assert.equal(__test.isRecoverableJsonError(new Error('A IA retornou JSON truncado ou incompleto.')), true);
      assert.equal(__test.isRecoverableJsonError(new Error("Expected ',' or '}' after property value in JSON at position 123")), true);
      assert.equal(__test.isRecoverableJsonError(new Error('Falha de rede externa.')), false);
    }
  },
  {
    name: 'parse image comparison reply from plain text fallback fields',
    run() {
      const parsed = __test.parseNanoBananaJsonReply('matched=true confidence=0.91 reason="Mesmo conteudo visual"');
      assert.equal(parsed.matched, true);
      assert.equal(parsed.confidence, 0.91);
      assert.equal(parsed.reason, 'Mesmo conteudo visual');
    }
  },
  {
    name: 'detect identical image attachments locally before calling provider',
    run() {
      const reference = { mimeType: 'image/png', data: 'YWJjMTIz', name: 'referencia.png' };
      const same = { mimeType: 'image/jpeg', data: 'YWJjMTIz', name: 'resposta.jpg' };
      const different = { mimeType: 'image/png', data: 'ZGlmZmVyZW50ZQ==', name: 'outra.png' };
      assert.equal(__test.areImageAttachmentsIdentical(reference, same), true);
      assert.equal(__test.areImageAttachmentsIdentical(reference, different), false);
    }
  },
  {
    name: 'do not infer story flow when request forbids creating more slides',
    run() {
      assert.equal(
        __test.requestSuggestsStoryFlow('Crie um layout apenas para este slide atual e nao crie outros slides.'),
        false
      );
      assert.equal(__test.requestExplicitlyForbidsNewSlides('Nao crie outros slides.'), true);
    }
  },
  {
    name: 'post process keeps single-slide request on the current slide',
    run() {
      const existingSlides = [{ id: 'slide-inicial', title: 'Slide 1', backgroundColor: '#fff', elements: [] }];
      const actions = __test.postProcessActions(
        [
          {
            type: 'update_slide',
            slideId: 'slide-inicial',
            slide: { title: 'Layout profissional', backgroundColor: '#f8fafc' }
          },
          {
            type: 'add_element',
            slideId: 'slide-inicial',
            element: {
              type: 'floatingButton',
              label: 'Continuar',
              x: 900,
              y: 560,
              width: 180,
              height: 60
            }
          }
        ],
        'Crie um layout profissional apenas para este slide atual e nao crie outros slides. Adicione um botao com acao funcional.',
        existingSlides
      );
      assert.equal(actions.some((action) => action.type === 'add_slide'), false);
      const buttonAction = actions.find((action) => action.type === 'add_element' && action.element?.type === 'floatingButton');
      assert.ok(buttonAction);
      assert.notEqual(buttonAction.element.actionConfig?.type, 'none');
    }
  }
];

let passed = 0;
for (const testCase of tests) {
  testCase.run();
  console.log(`ok - ${testCase.name}`);
  passed += 1;
}

console.log(`\n${passed}/${tests.length} tests passed`);
