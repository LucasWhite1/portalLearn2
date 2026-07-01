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
      assert.equal(summary.includedSlides, 8);
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
  },
  {
    name: 'reserve 13 unique slide ids even when planner repeats ids',
    run() {
      const existingSlides = [{ id: 'slide-inicial', title: 'Slide 1', elements: [] }];
      const rawPlan = {
        mode: 'deck',
        slides: Array.from({ length: 13 }, (_, index) => ({
          id: index % 2 ? 'slide-repetido' : 'outro-id-repetido',
          title: `Escravidao ${index + 1}`,
          goal: `Conteudo do slide ${index + 1}`
        }))
      };
      const plan = __test.normalizeExecutionPlan(
        rawPlan,
        'Crie 13 slides simples sobre a escravidao',
        existingSlides,
        'slide-inicial'
      );
      assert.equal(plan.mode, 'deck');
      assert.equal(plan.slides.length, 13);
      const targetIds = plan.slides.map((item) => item.targetSlideId);
      assert.equal(new Set(targetIds).size, 13);
      assert.equal(targetIds[0], 'slide-inicial');
      for (let index = 1; index < plan.slides.length; index += 1) {
        assert.equal(plan.slides[index].afterSlideId, plan.slides[index - 1].targetSlideId);
      }
    }
  },
  {
    name: 'keep isolated element request in simple mode even if planner over-expands it',
    run() {
      const plan = __test.normalizeExecutionPlan(
        { mode: 'deck', slides: [{ title: 'Bloco' }, { title: 'Slide extra indevido' }] },
        'Adicione um bloco azul no slide atual',
        [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        'slide-atual'
      );
      assert.equal(plan.mode, 'simple');
      assert.equal(plan.simpleTask.targetSlideId, 'slide-atual');
    }
  },
  {
    name: 'treat educational how-to prompt as freeform deck',
    run() {
      const plan = __test.normalizeExecutionPlan(
        { mode: 'simple', simpleTask: { title: 'Camisa' } },
        'Como usar uma camisa corretamente',
        [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        'slide-atual'
      );
      assert.equal(plan.mode, 'deck');
      assert.ok(plan.slides.length >= 3);
      assert.equal(__test.requestSuggestsEducationalDeck('Como usar uma camisa corretamente'), true);
    }
  },
  {
    name: 'execution prompt asks for freeform modern layout with box calculation',
    run() {
      const planItem = {
        id: 'slide-camisa',
        targetSlideId: 'slide-camisa',
        title: 'Como usar uma camisa corretamente',
        goal: 'Ensinar os passos para vestir e ajustar uma camisa.',
        imageIntent: 'required',
        order: 1,
        visualTheme: { palette: { background: '#f7f3ff', primary: '#6d5dfc', text: '#171934' } },
        slideStyle: { backgroundColor: '#f7f3ff' }
      };
      const prompt = __test.createAiPrompt({
        request: 'Como usar uma camisa corretamente',
        slides: [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        activeSlideId: 'slide-atual',
        stageSize: { width: 1280, height: 720 },
        executionPlan: { mode: 'deck', visualTheme: planItem.visualTheme },
        currentPlanItem: planItem
      });
      assert.match(prompt, /layout proprio, bonito e moderno/);
      assert.match(prompt, /calcule a caixa/i);
      assert.doesNotMatch(prompt, /templateReferences como base principal|layout base clonado|Nao recrie o layout do zero/);
    }
  },
  {
    name: 'execution plan prompt does not force template adaptation',
    run() {
      const prompt = __test.createAiExecutionPlanPrompt({
        request: 'Crie 5 slides sobre escravidao com quiz',
        slides: [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        activeSlideId: 'slide-atual',
        stageSize: { width: 1280, height: 720 }
      });
      assert.match(prompt, /layout proprio, bonito, moderno/);
      assert.doesNotMatch(prompt, /Planeje cada slide como adaptacao|Use templateReferences como base principal/);
    }
  },
  {
    name: 'force every planned action onto its reserved slide id',
    run() {
      const planItem = {
        id: 'slide-ai-02-contexto',
        targetSlideId: 'slide-ai-02-contexto',
        afterSlideId: 'slide-inicial',
        title: 'Contexto historico',
        order: 2
      };
      const normalized = __test.normalizePlanItemActions(
        [
          { type: 'add_slide', slide: { id: 'id-inventado', title: 'Outro titulo' } },
          {
            type: 'add_element',
            slideId: 'slide-errado',
            element: { id: 'titulo', type: 'text', content: 'Contexto', x: 20, y: 20, width: 400, height: 80 }
          }
        ],
        planItem,
        [{ id: 'slide-inicial', title: 'Inicial', elements: [] }]
      );
      const addSlide = normalized.find((action) => action.type === 'add_slide');
      const addElement = normalized.find((action) => action.type === 'add_element');
      assert.equal(addSlide.slide.id, planItem.targetSlideId);
      assert.equal(addSlide.afterSlideId, planItem.afterSlideId);
      assert.equal(addElement.slideId, planItem.targetSlideId);
    }
  },
  {
    name: 'repair empty planned slide with renderable fallback content',
    run() {
      const planItem = {
        id: 'slide-ai-03-resistencia',
        targetSlideId: 'slide-ai-03-resistencia',
        title: 'Resistencia',
        goal: 'Explicar formas de resistencia a escravidao.',
        order: 3
      };
      const actions = __test.ensurePlanItemHasRenderableContent(
        [{ type: 'add_slide', slide: { id: planItem.targetSlideId, title: planItem.title } }],
        planItem,
        []
      );
      assert.equal(__test.planItemHasRenderableContent(actions, planItem, []), true);
      assert.ok(actions.some((action) => action.type === 'add_element' && action.element?.type === 'text'));
      assert.ok(actions.some((action) => action.type === 'add_element' && action.element?.type === 'block'));
    }
  },
  {
    name: 'do not render planner instructions as final slide text',
    run() {
      const planItem = {
        id: 'slide-ai-escambo',
        targetSlideId: 'slide-ai-escambo',
        title: 'O Escambo: O que era?',
        goal: 'Definir o escambo como pratica de troca direta entre portugueses e indigenas.',
        layoutNotes: 'Reservar area de imagem a direita e card de conteudo a esquerda.',
        order: 2
      };
      const actions = __test.postProcessActions(
        [
          { type: 'add_slide', slide: { id: 'qualquer', title: planItem.title } },
          {
            type: 'add_element',
            slideId: 'qualquer',
            element: {
              id: 'card-plano',
              type: 'block',
              content: 'Definir o escambo como pratica de troca direta entre portugueses e indigenas.',
              x: 80,
              y: 260,
              width: 520,
              height: 240
            }
          }
        ],
        'Crie um slide sobre escambo',
        [],
        { currentPlanItem: planItem, disableStoryExpansion: true }
      );
      const card = actions.find((action) => action.element?.type === 'block' && action.element?.content)?.element;
      assert.ok(card);
      assert.equal(__test.looksLikePlannerInstructionText(card.content, planItem), false);
      assert.ok(card.content.includes('O escambo era'));
    }
  },
  {
    name: 'sanitize planner instructions from quiz and action config fields',
    run() {
      const planItem = {
        id: 'slide-ai-escambo',
        targetSlideId: 'slide-ai-escambo',
        title: 'O Escambo: O que era?',
        goal: 'Definir o escambo como pratica de troca direta entre portugueses e indigenas.'
      };
      const actions = __test.sanitizePlannerInstructionLeaks([
        {
          type: 'add_element',
          slideId: planItem.targetSlideId,
          element: {
            id: 'quiz',
            type: 'quiz',
            question: planItem.goal,
            options: [planItem.goal, 'Resposta correta', 'Resposta incorreta'],
            actionConfig: { type: 'addText', text: planItem.goal }
          }
        }
      ], planItem);
      const element = actions[0].element;
      assert.equal(__test.looksLikePlannerInstructionText(element.question, planItem), false);
      assert.equal(__test.looksLikePlannerInstructionText(element.options[0], planItem), false);
      assert.equal(__test.looksLikePlannerInstructionText(element.actionConfig.text, planItem), false);
    }
  },
  {
    name: 'shrink or compact long text so it fits element box',
    run() {
      const longText = 'Texto longo '.repeat(80);
      const actions = __test.sanitizeActionTextFit([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: {
            id: 'texto-longo',
            type: 'text',
            content: longText,
            x: 80,
            y: 120,
            width: 260,
            height: 80,
            fontSize: 28
          }
        }
      ], { width: 1280, height: 720 });
      const element = actions[0].element;
      assert.ok(element.content.length < longText.length);
      assert.ok(element.content.length <= __test.estimateTextCapacity(element));
      assert.ok(element.fontSize <= 28);
    }
  },
  {
    name: 'detect unresolved overlapping layout quality issues',
    run() {
      const issues = __test.collectActionQualityIssues([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'texto-1', type: 'text', content: 'Texto A', x: 100, y: 100, width: 300, height: 120 }
        },
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'texto-2', type: 'text', content: 'Texto B', x: 120, y: 120, width: 300, height: 120 }
        }
      ], [], { width: 1280, height: 720 }, null);
      assert.ok(issues.some((issue) => issue.code === 'text_overlap'));
    }
  },
  {
    name: 'ignore tiny layout intersections in quality validation',
    run() {
      const issues = __test.collectActionQualityIssues([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'texto-1', type: 'text', content: 'Texto A', x: 100, y: 100, width: 300, height: 120 }
        },
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'texto-2', type: 'text', content: 'Texto B', x: 390, y: 210, width: 300, height: 120 }
        }
      ], [], { width: 1280, height: 720 }, null);
      assert.equal(issues.some((issue) => issue.code === 'text_overlap'), false);
    }
  },
  {
    name: 'prune secondary generated element when layout still overlaps',
    run() {
      const actions = __test.repairRemainingLayoutConflicts([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'titulo-principal', type: 'text', content: 'Titulo', x: 80, y: 60, width: 600, height: 80 }
        },
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'texto-secundario', type: 'text', content: 'Texto secundario', x: 100, y: 70, width: 400, height: 90 }
        }
      ], []);
      assert.equal(actions.some((action) => action.element?.id === 'titulo-principal'), true);
      assert.equal(actions.some((action) => action.element?.id === 'texto-secundario'), false);
    }
  },
  {
    name: 'infer explicit image quantity preferences',
    run() {
      assert.equal(__test.inferRequestedImagePolicy('Crie 8 slides sem imagens'), 'none');
      assert.equal(__test.inferRequestedImagePolicy('Crie 8 slides com poucas imagens'), 'sparse');
      assert.equal(__test.inferRequestedImagePolicy('Crie 8 slides com imagens'), 'rich');
      assert.equal(__test.inferRequestedImagePolicy('Crie 8 slides com muitas imagens'), 'rich');
      assert.equal(__test.inferRequestedImagePolicy('Gere uma imagem de um navio'), 'sparse');
    }
  },
  {
    name: 'preserve timed trigger delay and configured action',
    run() {
      const [action] = __test.normalizeActionList([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: {
            type: 'timedTrigger',
            interactionTriggers: [
              {
                name: 'Revelar depois',
                time: 4.5,
                actionConfig: { type: 'showElement', targetElementId: 'texto-oculto' }
              }
            ]
          }
        }
      ]);
      assert.equal(action.element.interactionTriggers[0].time, 4.5);
      assert.equal(action.element.interactionTriggers[0].actionConfig.type, 'showElement');
      assert.equal(action.element.interactionTriggers[0].actionConfig.targetElementId, 'texto-oculto');
    }
  },
  {
    name: 'attach one visual theme and slide styles to deck plan',
    run() {
      const plan = __test.normalizeExecutionPlan(
        {
          mode: 'deck',
          slides: [
            { title: 'Contexto', goal: 'Apresentar contexto' },
            { title: 'Desafio', goal: 'Associar conceitos', interactionNotes: 'arrastar e colar' }
          ]
        },
        'Crie 2 slides gamificados sobre historia com arrastar e colar',
        [{ id: 'slide-inicial', title: 'Inicial', elements: [] }],
        'slide-inicial'
      );
      assert.equal(plan.mode, 'deck');
      assert.ok(plan.visualTheme?.palette?.primary);
      assert.equal(plan.slides[0].visualTheme.key, plan.visualTheme.key);
      assert.equal(plan.slides[0].slideStyle.backgroundFillType, 'gradient');
      assert.equal(plan.slides[1].interactionType, 'drag-drop');
    }
  },
  {
    name: 'move overlapping text away from content block with safety margin',
    run() {
      const actions = __test.resolveActionLayoutCollisions(
        [
          {
            type: 'add_element',
            slideId: 'slide-1',
            element: { id: 'card', type: 'block', content: 'Card', x: 80, y: 100, width: 420, height: 240 }
          },
          {
            type: 'add_element',
            slideId: 'slide-1',
            element: { id: 'texto', type: 'text', content: 'Texto', x: 100, y: 130, width: 300, height: 80 }
          }
        ],
        [{ id: 'slide-1', title: 'Slide', elements: [] }],
        { width: 1280, height: 720 }
      );
      const text = actions[1].element;
      assert.notEqual(text.x, 100);
      assert.notEqual(text.y, 130);
      assert.ok(text.x >= 32);
      assert.ok(text.y >= 32);
    }
  },
  {
    name: 'repair drag-drop planned slide with draggable piece and functional detector',
    run() {
      const theme = __test.inferDeckVisualTheme('aula gamificada de historia');
      const planItem = {
        id: 'slide-ai-drag',
        targetSlideId: 'slide-ai-drag',
        title: 'Associe os conceitos',
        goal: 'Arraste o conceito correto para a area de resposta.',
        order: 2,
        interactionType: 'drag-drop',
        visualTheme: theme,
        slideStyle: __test.getThemeSlideStyle(theme, 1)
      };
      const actions = __test.ensurePlanItemHasRenderableContent(
        [{ type: 'add_slide', slide: { id: planItem.targetSlideId, title: planItem.title } }],
        planItem,
        []
      );
      const draggable = actions.find((action) => action.element?.studentCanDrag);
      const detector = actions.find((action) => action.element?.type === 'detector');
      assert.ok(draggable);
      assert.ok(detector);
      assert.equal(detector.element.actionConfig.detectorAcceptedDrag, `element:${draggable.element.id}`);
      assert.equal(detector.element.interactionTriggers[0].actionConfig.detectorTriggerOnce, true);
    }
  },
  {
    name: 'align detector with visual drop zone and repair missing showElement target',
    run() {
      const planItem = {
        id: 'slide-ai-drop',
        targetSlideId: 'slide-ai-drop',
        title: 'Arraste para o local correto',
        goal: 'Associe o item ao alvo certo.',
        interactionType: 'drag-drop'
      };
      const actions = __test.repairDragDropDetectorConfiguration(
        [
          {
            type: 'add_element',
            slideId: 'slide-ai-drop',
            element: {
              id: 'peca-1',
              type: 'block',
              content: 'Peca',
              x: 120,
              y: 500,
              width: 180,
              height: 72,
              studentCanDrag: true
            }
          },
          {
            type: 'add_element',
            slideId: 'slide-ai-drop',
            element: {
              id: 'alvo-visual',
              type: 'block',
              content: 'Solte aqui',
              x: 310,
              y: 260,
              width: 240,
              height: 150
            }
          },
          {
            type: 'add_element',
            slideId: 'slide-ai-drop',
            element: {
              id: 'feedback',
              type: 'block',
              content: 'Correto!',
              x: 620,
              y: 320,
              width: 260,
              height: 70
            }
          },
          {
            type: 'add_element',
            slideId: 'slide-ai-drop',
            element: {
              id: 'detector-1',
              type: 'detector',
              x: 700,
              y: 120,
              width: 100,
              height: 100,
              actionConfig: { type: 'showElement' },
              interactionTriggers: [{ id: 't1', name: 'Ao encaixar', enabled: true, actionConfig: { type: 'showElement' } }]
            }
          }
        ],
        [],
        planItem
      );
      const detector = actions.find((action) => action.element?.id === 'detector-1')?.element;
      const visualTarget = actions.find((action) => action.element?.id === 'alvo-visual')?.element;
      const feedback = actions.find((action) => action.element?.id === 'feedback')?.element;
      assert.ok(detector);
      assert.equal(detector.x, visualTarget.x);
      assert.equal(detector.y, visualTarget.y);
      assert.equal(detector.width, visualTarget.width);
      assert.equal(detector.height, visualTarget.height);
      assert.equal(detector.actionConfig.type, 'showElement');
      assert.equal(detector.actionConfig.targetElementId, 'feedback');
      assert.equal(detector.actionConfig.detectorAcceptedDrag, 'element:peca-1');
      assert.equal(detector.interactionTriggers[0].actionConfig.targetElementId, 'feedback');
      assert.equal(feedback.initiallyHidden, true);
    }
  },
  {
    name: 'normalize deprecated DeepSeek chat model to v4 pro',
    run() {
      assert.equal(__test.normalizeProviderModel('deepseek', 'https://api.deepseek.com', 'deepseek-chat'), 'deepseek-v4-pro');
      assert.equal(__test.normalizeProviderModel('deepseek', 'https://api.deepseek.com', 'deepseek-v4-flash'), 'deepseek-v4-flash');
    }
  },
  {
    name: 'balanced deck reserves generated images on strategic slides',
    run() {
      const plan = __test.normalizeExecutionPlan(
        {
          mode: 'deck',
          slides: Array.from({ length: 8 }, (_, index) => ({
            title: `Slide ${index + 1}`,
            goal: `Explicar topico ${index + 1}`
          }))
        },
        'Crie 8 slides sobre a escravidao com visual profissional',
        [{ id: 'slide-inicial', title: 'Inicial', elements: [] }],
        'slide-inicial'
      );
      assert.equal(plan.slides[0].imageIntent, 'required');
      assert.ok(plan.slides.some((item, index) => index > 0 && item.imageIntent === 'required'));
    }
  },
  {
    name: 'rich image deck requires several generated images without forcing every interactive slide',
    run() {
      const plan = __test.normalizeExecutionPlan(
        {
          mode: 'deck',
          slides: Array.from({ length: 13 }, (_, index) => ({
            title: `Slide ${index + 1}`,
            goal: `Explicar topico ${index + 1}`
          }))
        },
        'Crie 13 slides sobre a escravidao com imagens, quiz e arrastar e colar',
        [{ id: 'slide-inicial', title: 'Inicial', elements: [] }],
        'slide-inicial'
      );
      const requiredCount = plan.slides.filter((item) => item.imageIntent === 'required').length;
      assert.ok(requiredCount >= 4);
      assert.ok(requiredCount < plan.slides.length);
      assert.ok(plan.slides.some((item) => item.interactionType === 'drag-drop'));
      assert.ok(plan.slides.some((item) => item.imageIntent === 'optional'));
    }
  },
  {
    name: 'inject generated image when required slide forgot it',
    run() {
      const planItem = {
        targetSlideId: 'slide-visual',
        title: 'Navios negreiros',
        goal: 'Explicar o contexto visual da travessia.',
        imageIntent: 'required'
      };
      const actions = __test.ensureRequiredImageGeneration(
        [{ type: 'add_element', slideId: 'slide-visual', element: { type: 'text', content: 'Titulo', x: 40, y: 40, width: 400, height: 80 } }],
        'Crie um slide sobre escravidao',
        planItem,
        { width: 1280, height: 720 }
      );
      const imageAction = actions.find((action) => action.element?.type === 'image');
      assert.ok(imageAction);
      assert.ok(imageAction.element.generationPrompt.includes('Navios negreiros'));
    }
  },
  {
    name: 'detect actions that need Nano Banana',
    run() {
      assert.equal(
        __test.actionListNeedsNanoBanana([
          { type: 'add_element', slideId: 'slide-1', element: { type: 'image', generationPrompt: 'imagem educacional' } }
        ]),
        true
      );
      assert.equal(
        __test.actionListNeedsNanoBanana([
          { type: 'add_element', slideId: 'slide-1', element: { type: 'image', src: 'data:image/png;base64,abc' } }
        ]),
        false
      );
    }
  },
  {
    name: 'replace forbidden generated image with placeholder block when request asks only for image space',
    run() {
      assert.equal(
        __test.inferRequestedImagePolicy('crie 3 slides. Deixe os espaços da imagem mas sem gerar imagens'),
        'none'
      );
      const actions = __test.postProcessActions(
        [
          {
            type: 'add_element',
            slideId: 'slide-1',
            element: {
              id: 'img-1',
              type: 'image',
              x: 760,
              y: 150,
              width: 300,
              height: 220,
              generationPrompt: 'pintura historica'
            }
          }
        ],
        'Crie 3 slides sobre escravidao. Deixe os espacos da imagem mas sem gerar imagens.',
        [{ id: 'slide-1', title: 'Inicial', elements: [] }],
        {
          currentPlanItem: {
            targetSlideId: 'slide-1',
            title: 'Contexto',
            goal: 'Explicar o contexto historico.',
            imageIntent: 'none'
          }
        }
      );
      const placeholder = actions.find((action) =>
        action.type === 'add_element'
        && action.slideId === 'slide-1'
        && action.element?.type === 'block'
        && /espaco da imagem/i.test(String(action.element.content || ''))
      );
      assert.ok(placeholder);
      assert.equal(placeholder.element.type, 'block');
      assert.match(placeholder.element.content, /espaco da imagem/i);
      assert.equal(Boolean(placeholder.element.generationPrompt), false);
    }
  },
  {
    name: 'convert already generated image src to placeholder when prompt forbids image generation',
    run() {
      const actions = __test.postProcessActions(
        [
          {
            type: 'add_element',
            slideId: 'slide-1',
            element: {
              id: 'imagem-gerada',
              type: 'image',
              src: 'data:image/png;base64,abc',
              x: 660,
              y: 147,
              width: 588,
              height: 480
            }
          }
        ],
        'crie 3 slides falando da escravidão dos indios que se vendia por mercadorias dos portugueses. Deixe os espaços da imagem mas sem gerar imagens',
        [{ id: 'slide-1', title: 'Inicial', elements: [] }],
        {
          currentPlanItem: {
            targetSlideId: 'slide-1',
            title: 'O encontro e a troca inicial',
            goal: 'Explicar o escambo e o inicio da exploracao indigena.',
            imageIntent: 'none'
          }
        }
      );
      assert.equal(actions.some((action) => action.element?.type === 'image'), false);
      assert.equal(actions.some((action) => /data:image/i.test(String(action.element?.src || ''))), false);
      assert.ok(actions.some((action) => action.element?.type === 'block' && /espaco da imagem/i.test(String(action.element.content || ''))));
    }
  },
  {
    name: 'empty support block stays behind explanatory text',
    run() {
      const actions = __test.repairEmptySupportBlockStacking([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: {
            id: 'texto-escambo',
            type: 'text',
            content: 'Texto explicativo do slide.',
            x: 32,
            y: 150,
            width: 560,
            height: 420,
            zIndex: 2
          }
        },
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: {
            id: 'card-vazio',
            type: 'block',
            content: '',
            x: 32,
            y: 212,
            width: 536,
            height: 476,
            zIndex: 5
          }
        }
      ]);
      const text = actions.find((action) => action.element?.id === 'texto-escambo').element;
      const card = actions.find((action) => action.element?.id === 'card-vazio').element;
      assert.ok(Number(card.zIndex) < Number(text.zIndex));
    }
  },
  {
    name: 'fallback renderable content creates slide when target slide does not exist yet',
    run() {
      const actions = __test.ensurePlanItemHasRenderableContent(
        [],
        {
          id: 'plan-2',
          targetSlideId: 'slide-novo',
          afterSlideId: 'slide-1',
          order: 2,
          title: 'Novo slide',
          goal: 'Apresentar um resumo claro.'
        },
        [{ id: 'slide-1', title: 'Inicial', elements: [] }]
      );
      assert.equal(actions[0].type, 'add_slide');
      assert.equal(actions[0].slide.id, 'slide-novo');
      assert.equal(actions.some((action) => action.type === 'update_slide' && action.slideId === 'slide-novo'), false);
    }
  },
  {
    name: 'lonely bullet markers receive supporting text blocks',
    run() {
      const actions = __test.postProcessActions(
        [
          {
            type: 'add_element',
            slideId: 'slide-1',
            element: {
              id: 'dot-1',
              type: 'block',
              x: 410,
              y: 210,
              width: 40,
              height: 40,
              backgroundColor: '#ea8a00'
            }
          },
          {
            type: 'add_element',
            slideId: 'slide-1',
            element: {
              id: 'dot-2',
              type: 'block',
              x: 410,
              y: 340,
              width: 40,
              height: 40,
              backgroundColor: '#ea8a00'
            }
          }
        ],
        'Crie um slide elegante sobre as consequencias da escravidao indigena.',
        [{ id: 'slide-1', title: 'Inicial', elements: [] }],
        {
          currentPlanItem: {
            targetSlideId: 'slide-1',
            title: 'Consequencias e legado',
            goal: 'Explicar as consequencias da escravidao indigena para os povos originarios e para a formacao do Brasil.',
            imageIntent: 'none'
          }
        }
      );
      const generatedTexts = actions.filter((action) =>
        action.type === 'add_element'
        && action.slideId === 'slide-1'
        && action.element?.type === 'block'
        && /consequencias|escravidao|povos originarios|brasil/i.test(String(action.element.content || ''))
      );
      assert.ok(generatedTexts.length >= 1);
      const bullet = actions.find((action) =>
        action.type === 'add_element'
        && action.slideId === 'slide-1'
        && action.element?.type === 'block'
        && Number(action.element.width) <= 40
        && Number(action.element.height) <= 40
      );
      assert.ok(bullet);
      assert.equal(bullet.element.content, '*');
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
