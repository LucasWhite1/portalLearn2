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
      assert.equal(summary.length, 6);
      assert.equal(summary[0].elements.length, 12);
      assert.ok(summary[0].elements[0].label.length <= 80);
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
  }
];

let passed = 0;
for (const testCase of tests) {
  testCase.run();
  console.log(`ok - ${testCase.name}`);
  passed += 1;
}

console.log(`\n${passed}/${tests.length} tests passed`);
