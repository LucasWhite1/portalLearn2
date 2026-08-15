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
    name: 'build deterministic action for simple block text prompt',
    run() {
      const actions = __test.buildSimpleBlockTextActions({
        request: 'crie um bloco escrito ok',
        slides: [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        activeSlideId: 'slide-atual',
        stageSize: { width: 1280, height: 720 }
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, 'add_element');
      assert.equal(actions[0].slideId, 'slide-atual');
      assert.equal(actions[0].element.type, 'block');
      assert.equal(actions[0].element.content, 'ok');
      assert.deepEqual(
        __test.collectActionQualityIssues(actions, [], { width: 1280, height: 720 }, null),
        []
      );
    }
  },
  {
    name: 'honor requested block color and keep its text readable',
    run() {
      const actions = __test.buildSimpleBlockTextActions({
        request: 'crie um bloco vermelho com o nome oi',
        slides: [{ id: 'slide-atual', title: 'Atual', elements: [], backgroundColor: '#ffffff' }],
        activeSlideId: 'slide-atual',
        stageSize: { width: 1280, height: 720 }
      });
      assert.equal(actions[0].element.content, 'oi');
      assert.equal(actions[0].element.backgroundColor, '#dc2626');
      assert.equal(actions[0].element.solidColor, '#dc2626');
      assert.equal(actions[0].element.textColor, '#ffffff');
    }
  },
  {
    name: 'update text color inside the selected block instead of creating another block',
    run() {
      const actions = __test.buildSimpleElementColorActions({
        request: 'troque a cor do texto pra preto',
        slides: [{
          id: 'slide-atual',
          elements: [
            { id: 'bloco-oi', type: 'block', content: 'Oi', backgroundColor: '#dc2626', textColor: '#ffffff' },
            { id: 'outro-texto', type: 'text', content: 'Outro elemento', textColor: '#ffffff' }
          ]
        }],
        activeSlideId: 'slide-atual',
        selectedElementId: 'bloco-oi'
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, 'update_element');
      assert.equal(actions[0].elementId, 'bloco-oi');
      assert.equal(actions[0].element.textColor, '#111827');
      assert.equal(actions[0].element.backgroundColor, undefined);
    }
  },
  {
    name: 'understand required text color phrasing as an edit to the selected block',
    run() {
      const actions = __test.buildSimpleElementColorActions({
        request: 'o texto tem que tá na cor vermelha',
        slides: [{
          id: 'slide-atual',
          elements: [
            { id: 'bloco-grande-dia', type: 'block', content: 'grande dia!', backgroundColor: '#facc15', textColor: '#111827' },
            { id: 'texto-solto', type: 'text', content: 'Outro texto', textColor: '#111827' }
          ]
        }],
        activeSlideId: 'slide-atual',
        selectedElementId: 'bloco-grande-dia'
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, 'update_element');
      assert.equal(actions[0].elementId, 'bloco-grande-dia');
      assert.equal(actions[0].element.textColor, '#dc2626');
      assert.equal(actions[0].element.backgroundColor, undefined);
    }
  },
  {
    name: 'update the latest block color without invoking the model',
    run() {
      const actions = __test.buildSimpleElementColorActions({
        request: 'mude a cor do bloco para vermelho',
        slides: [{
          id: 'slide-atual',
          elements: [{ id: 'bloco-1', type: 'block', content: 'Oi', backgroundColor: '#f97316' }]
        }],
        activeSlideId: 'slide-atual'
      });
      assert.equal(actions[0].type, 'update_element');
      assert.equal(actions[0].elementId, 'bloco-1');
      assert.equal(actions[0].element.backgroundColor, '#dc2626');
      assert.equal(actions[0].element.textColor, '#ffffff');
    }
  },
  {
    name: 'build deterministic action for simple slide background color prompt',
    run() {
      const actions = __test.buildSimpleBackgroundColorActions({
        request: 'troque a cor de fundo para verde',
        slides: [{ id: 'slide-atual', title: 'Atual', elements: [], backgroundColor: '#ffffff' }],
        activeSlideId: 'slide-atual'
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, 'update_slide');
      assert.equal(actions[0].slideId, 'slide-atual');
      assert.equal(actions[0].slide.backgroundColor, '#16a34a');
      assert.equal(actions[0].slide.backgroundFillType, 'solid');
    }
  },
  {
    name: 'apply an English background color to every real slide deterministically',
    run() {
      const slides = [
        { id: 'slide-1', title: 'Um', elements: [] },
        { id: 'slide-2', title: 'Dois', elements: [] },
        { id: 'slide-3', title: 'Tres', elements: [] }
      ];
      const actions = __test.buildSimpleBackgroundColorActions({
        request: 'mude o fundo de todos os slides para Yellow',
        slides,
        activeSlideId: 'slide-2'
      });
      assert.equal(__test.extractSimpleBackgroundColorRequest('mude o fundo para Yellow'), '#facc15');
      assert.deepEqual(actions.map((action) => action.slideId), ['slide-1', 'slide-2', 'slide-3']);
      assert.equal(actions.every((action) => action.slide.backgroundColor === '#facc15'), true);
      assert.equal(actions.every((action) => action.slide.backgroundFillType === 'solid'), true);
    }
  },
  {
    name: 'use deterministic simple block path even with a simple execution plan',
    run() {
      assert.equal(__test.shouldUseDeterministicSimpleBlock({
        request: 'crie um bloco escrito ok',
        attachments: [],
        executionPlan: { mode: 'simple', simpleTask: { targetSlideId: 'slide-atual' } }
      }), true);
      assert.equal(__test.shouldUseDeterministicSimpleBlock({
        request: 'crie um bloco escrito ok',
        attachments: [],
        executionPlan: { mode: 'deck', slides: [] }
      }), false);
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
    name: 'replace repeated planner text with distinct lesson content',
    run() {
      const planItem = {
        id: 'slide-ai-impactos',
        targetSlideId: 'slide-ai-impactos',
        title: 'Principais areas impactadas',
        goal: 'Mostrar visualmente os setores transformados pela IA: saude, educacao, negocios e criatividade.',
        contentBrief: {
          keyMessage: 'A IA muda decisoes, processos e formas de criar em diferentes setores.',
          supportingPoints: [
            'Na saude, modelos ajudam a identificar riscos em exames e priorizar atendimentos.',
            'Na educacao, sistemas adaptativos ajustam atividades ao ritmo de cada aluno.',
            'Nos negocios, a automacao reduz tarefas repetitivas e apoia previsoes.'
          ],
          example: 'Um professor pode adaptar exercicios a partir dos erros mais frequentes da turma.',
          takeaway: 'O impacto depende de combinar tecnologia, criterio humano e responsabilidade.'
        },
        order: 2
      };
      const actions = __test.postProcessActions(
        [
          { type: 'add_slide', slide: { id: planItem.targetSlideId, title: planItem.title } },
          {
            type: 'add_element',
            slideId: planItem.targetSlideId,
            element: {
              id: 'texto-1', type: 'block', content: planItem.goal,
              x: 72, y: 180, width: 500, height: 180
            }
          },
          {
            type: 'add_element',
            slideId: planItem.targetSlideId,
            element: {
              id: 'texto-2', type: 'block', content: planItem.goal,
              x: 650, y: 180, width: 500, height: 180
            }
          }
        ],
        'crie 3 slides falando sobre a revolucao da IA',
        [],
        { currentPlanItem: planItem, disableStoryExpansion: true }
      );
      const texts = actions
        .filter((action) => action.type === 'add_element' && action.element?.content)
        .map((action) => action.element.content);
      assert.ok(texts.length >= 2);
      assert.equal(texts.some((text) => /mostrar visualmente/i.test(text)), false);
      assert.equal(__test.areTextsSubstantiallyDuplicate(texts[0], texts[1]), false);
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
      assert.doesNotMatch(element.content, /\.{3}|…/);
    }
  },
  {
    name: 'preserve overflowing lesson text in progressive details instead of failing',
    run() {
      const fullText = [
        'A inteligencia artificial combina diferentes tecnicas para reconhecer padroes e apoiar decisoes.',
        'Modelos de linguagem analisam contexto, sistemas de visao interpretam imagens e algoritmos preditivos estimam cenarios.',
        'Na pratica, o resultado depende da qualidade dos dados, da supervisao humana e de criterios claros de responsabilidade.',
        'Em uma escola, por exemplo, a tecnologia pode identificar dificuldades recorrentes sem substituir a avaliacao do professor.'
      ].join(' ').repeat(3);
      const planItem = {
        id: 'slide-overflow',
        targetSlideId: 'slide-overflow',
        title: 'Como a IA funciona',
        archetype: 'split-visual',
        visualTheme: __test.inferDeckVisualTheme('aula sobre inteligencia artificial'),
        contentBrief: { keyMessage: fullText }
      };
      let actions = [{
        type: 'add_element',
        slideId: 'slide-overflow',
        element: {
          id: 'conteudo-longo',
          type: 'block',
          layoutRole: 'body',
          content: fullText,
          x: 64,
          y: 196,
          width: 560,
          height: 113,
          fontSize: 21
        }
      }];
      actions = __test.repairTextOverflowWithProgressiveDisclosure(
        actions,
        planItem,
        { width: 1280, height: 720 }
      );
      const visible = actions.find((action) => action.element?.id === 'conteudo-longo')?.element;
      const overlay = actions.find((action) => action.element?.initiallyHidden && action.element?.type === 'block')?.element;
      const openButton = actions.find((action) => action.element?.label === 'Ver detalhes')?.element;
      const closeButton = actions.find((action) => action.element?.label === 'Fechar detalhes')?.element;
      assert.ok(visible.content.length < fullText.length);
      assert.ok(overlay.content.includes(fullText));
      assert.equal(openButton.actionConfig.targetElementId, overlay.id);
      assert.equal(closeButton.actionConfig.targetElementId, overlay.id);
      assert.equal(
        __test.collectActionQualityIssues(actions, [], { width: 1280, height: 720 }, planItem)
          .some((issue) => issue.code === 'too_much_text'),
        false
      );
    }
  },
  {
    name: 'post processing repairs overflow only after final grid composition',
    run() {
      const fullText = 'A automacao apoia o trabalho humano quando existe contexto, supervisao e responsabilidade. '.repeat(25).trim();
      const planItem = {
        id: 'slide-grid-overflow',
        targetSlideId: 'slide-grid-overflow',
        title: 'IA com responsabilidade',
        archetype: 'split-visual',
        interactionType: 'content',
        visualTheme: __test.inferDeckVisualTheme('aula sobre IA responsavel'),
        contentBrief: {
          keyMessage: fullText,
          supportingPoints: [
            'Dados de qualidade reduzem conclusoes enganosas.',
            'Revisao humana continua essencial em decisoes importantes.'
          ]
        }
      };
      const actions = __test.postProcessActions([
        {
          type: 'add_slide',
          slide: { id: planItem.targetSlideId, title: planItem.title }
        },
        {
          type: 'add_element',
          slideId: planItem.targetSlideId,
          element: {
            id: 'mensagem-principal',
            type: 'block',
            layoutRole: 'body',
            content: fullText,
            x: 20,
            y: 20,
            width: 900,
            height: 300,
            fontSize: 24
          }
        }
      ], 'Crie um slide detalhado sobre IA responsavel', [], {
        disableStoryExpansion: true,
        currentPlanItem: planItem,
        executionPlan: { mode: 'deck', visualTheme: planItem.visualTheme },
        stageSize: { width: 1280, height: 720 }
      });
      const overlay = actions.find((action) => action.element?.initiallyHidden && action.element?.type === 'block')?.element;
      assert.ok(overlay?.content.includes(fullText));
      assert.equal(
        __test.collectActionQualityIssues(actions, [], { width: 1280, height: 720 }, planItem)
          .some((issue) => issue.code === 'too_much_text'),
        false
      );
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
    name: 'ignore text overlaps that already existed before generated actions',
    run() {
      const existingSlides = [
        {
          id: 'slide-1',
          title: 'Atual',
          elements: [
            { id: 'old-a', type: 'text', content: 'A', x: 100, y: 100, width: 240, height: 80 },
            { id: 'old-b', type: 'text', content: 'B', x: 120, y: 120, width: 240, height: 80 }
          ]
        }
      ];
      const issues = __test.collectActionQualityIssues([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'new-block', type: 'block', content: 'ok', x: 760, y: 420, width: 260, height: 120 }
        }
      ], existingSlides, { width: 1280, height: 720 }, null);
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
    name: 'preserve trigger toggle target generated by AI',
    run() {
      const [action] = __test.normalizeActionList([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: {
            type: 'floatingButton',
            interactionTriggers: [
              {
                id: 'control-trigger',
                actionConfig: { type: 'toggleTrigger', targetTriggerId: 'target-trigger' }
              }
            ]
          }
        }
      ]);
      assert.equal(action.element.interactionTriggers[0].actionConfig.type, 'toggleTrigger');
      assert.equal(action.element.interactionTriggers[0].actionConfig.targetTriggerId, 'target-trigger');
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
  },
  {
    name: 'deck plan carries one design system and balanced interaction sequence',
    run() {
      const plan = __test.normalizeExecutionPlan(
        {
          mode: 'deck',
          slides: Array.from({ length: 6 }, (_, index) => ({
            title: `Etapa ${index + 1}`,
            goal: `Explicar o conceito ${index + 1}.`
          }))
        },
        'Crie 6 slides para uma aula completa sobre cidadania digital',
        [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        'slide-atual'
      );
      assert.equal(plan.mode, 'deck');
      assert.equal(plan.interactionStrategy.density, 'balanced');
      assert.equal(plan.designSystem.spacing.gridColumns, 12);
      assert.ok(plan.slides.every((slide) => slide.designSystem === plan.designSystem));
      assert.ok(plan.slides.some((slide) => slide.interactionType === 'quiz'));
      assert.ok(plan.slides.some((slide) => slide.interactionType === 'reveal'));
      assert.ok(plan.slides.every((slide) => slide.archetype && slide.animationIntent));
    }
  },
  {
    name: 'template references become visual dna without copying content',
    run() {
      const dna = __test.summarizeTemplateDesignDna([
        {
          key: 'aula-referencia',
          slides: [
            { archetype: 'hero', palette: ['#112233', '#ffffff'] },
            { archetype: 'quiz', palette: ['#112233', '#ffcc00'] }
          ]
        }
      ]);
      assert.deepEqual(dna.sourceKeys, ['aula-referencia']);
      assert.deepEqual(dna.archetypes, ['hero', 'quiz']);
      assert.equal(dna.referenceMargins.columns, 12);
      assert.ok(dna.paletteHints.includes('#112233'));
    }
  },
  {
    name: 'design grid composes semantic elements into a split visual layout',
    run() {
      const planItem = {
        targetSlideId: 'slide-1',
        title: 'Aula visual',
        archetype: 'split-visual',
        animationIntent: 'staggered-entrance',
        designSystem: __test.buildDeckDesignSystem(__test.inferDeckVisualTheme('aula criativa'))
      };
      const actions = __test.composeActionsWithDesignGrid([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'titulo', type: 'text', layoutRole: 'title', content: 'Aula visual', x: 0, y: 0, width: 100, height: 30 }
        },
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'corpo', type: 'block', layoutRole: 'body', content: 'Conteudo principal', x: 0, y: 0, width: 100, height: 30 }
        },
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: { id: 'imagem', type: 'image', layoutRole: 'visual', generationPrompt: 'imagem', x: 0, y: 0, width: 100, height: 30 }
        }
      ], planItem);
      const title = actions.find((action) => action.element?.id === 'titulo').element;
      const body = actions.find((action) => action.element?.id === 'corpo').element;
      const image = actions.find((action) => action.element?.id === 'imagem').element;
      assert.ok(title.x >= 56 && title.fontSize >= 42);
      assert.ok(body.x < image.x);
      assert.ok(image.x + image.width <= 1280);
      assert.equal(title.animationLoop, false);
    }
  },
  {
    name: 'planned quiz recipe creates a complete functional quiz',
    run() {
      const planItem = {
        targetSlideId: 'slide-quiz',
        title: 'Seguranca digital',
        goal: 'Explicar que senhas fortes combinam caracteres diferentes.',
        interactionType: 'quiz',
        visualTheme: __test.inferDeckVisualTheme('aula criativa')
      };
      const actions = __test.ensurePlannedInteractionRecipe([], planItem, { mode: 'deck' });
      const quiz = actions.find((action) => action.element?.type === 'quiz')?.element;
      assert.ok(quiz);
      assert.equal(quiz.options.length, 3);
      assert.equal(quiz.correctOption, 0);
      assert.ok(quiz.successMessage && quiz.errorMessage && quiz.actionLabel);
    }
  },
  {
    name: 'planned reveal recipe links button to an existing hidden target',
    run() {
      const planItem = {
        targetSlideId: 'slide-reveal',
        title: 'Descubra o conceito',
        goal: 'Explicar o conceito depois da tentativa do aluno.',
        interactionType: 'reveal',
        visualTheme: __test.inferDeckVisualTheme('aula criativa')
      };
      const actions = __test.ensurePlannedInteractionRecipe([], planItem, { mode: 'deck' });
      const hidden = actions.find((action) => action.element?.initiallyHidden)?.element;
      const button = actions.find((action) => action.element?.type === 'floatingButton')?.element;
      assert.ok(hidden && button);
      assert.equal(button.actionConfig.type, 'showElement');
      assert.equal(button.actionConfig.targetElementId, hidden.id);
    }
  },
  {
    name: 'planned drag drop recipe creates aligned target detector and feedback',
    run() {
      const planItem = {
        targetSlideId: 'slide-drag',
        title: 'Classifique o conceito',
        goal: 'Associar o conceito a categoria correta.',
        interactionType: 'drag-drop',
        archetype: 'drag-drop',
        visualTheme: __test.inferDeckVisualTheme('jogo educativo'),
        designSystem: __test.buildDeckDesignSystem(__test.inferDeckVisualTheme('jogo educativo'))
      };
      let actions = __test.ensurePlannedInteractionRecipe([], planItem, { mode: 'deck' });
      actions = __test.composeActionsWithDesignGrid(actions, planItem);
      const draggable = actions.find((action) => action.element?.studentCanDrag)?.element;
      const target = actions.find((action) => action.element?.layoutRole === 'target' && action.element?.type === 'block')?.element;
      const detector = actions.find((action) => action.element?.type === 'detector')?.element;
      const feedback = actions.find((action) => action.element?.layoutRole === 'feedback')?.element;
      assert.ok(draggable && target && detector && feedback);
      assert.equal(detector.actionConfig.detectorAcceptedDrag, `element:${draggable.id}`);
      assert.deepEqual(
        [detector.x, detector.y, detector.width, detector.height],
        [target.x, target.y, target.width, target.height]
      );
      assert.equal(detector.actionConfig.targetElementId, feedback.id);
    }
  },
  {
    name: 'functional design audit detects low contrast',
    run() {
      const theme = __test.inferDeckVisualTheme('aula criativa');
      const planItem = {
        targetSlideId: 'slide-1',
        visualTheme: theme,
        designSystem: __test.buildDeckDesignSystem(theme),
        slideStyle: { backgroundColor: '#f7f3ff' }
      };
      const issues = __test.collectFunctionalDesignIssues([
        {
          type: 'add_element',
          slideId: 'slide-1',
          element: {
            id: 'texto',
            type: 'block',
            content: 'Texto sem contraste',
            textColor: '#ffffff',
            backgroundColor: '#ffffff',
            solidColor: '#ffffff',
            x: 72, y: 220, width: 400, height: 160
          }
        }
      ], [], planItem);
      assert.ok(issues.some((issue) => issue.code === 'low_contrast'));
    }
  },
  {
    name: 'safe archetype fallback passes quality audit for balanced interactive slides',
    run() {
      const plan = __test.normalizeExecutionPlan(
        {
          mode: 'deck',
          slides: Array.from({ length: 5 }, (_, index) => ({
            title: `Conceito ${index + 1}`,
            goal: `Explicar e praticar o conceito ${index + 1}.`
          }))
        },
        'Crie 5 slides interativos para associar e classificar conceitos',
        [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        'slide-atual'
      );
      const interactiveItems = plan.slides.filter((item) => ['quiz', 'reveal', 'drag-drop'].includes(item.interactionType));
      assert.ok(interactiveItems.length >= 2);
      interactiveItems.forEach((planItem) => {
        const actions = __test.buildSafeArchetypeFallbackActions(
          [],
          'Crie 5 slides interativos para associar e classificar conceitos',
          [],
          planItem,
          plan,
          { width: 1280, height: 720 }
        );
        const issues = __test.collectActionQualityIssues(actions, [], { width: 1280, height: 720 }, planItem);
        assert.deepEqual(issues, [], `${planItem.interactionType}: ${JSON.stringify(issues)}`);
      });
    }
  },
  {
    name: 'planned deck slide uses deterministic layout-first execution',
    run() {
      assert.equal(__test.shouldUseDeterministicPlannedSlide({
        executionPlan: { mode: 'deck' },
        currentPlanItem: {
          targetSlideId: 'slide-ia',
          contentBrief: { keyMessage: 'A IA amplia a capacidade de analisar e criar.' }
        }
      }), true);
      assert.equal(__test.shouldUseDeterministicPlannedSlide({
        executionPlan: { mode: 'simple' },
        currentPlanItem: { targetSlideId: 'slide-ia', contentBrief: { keyMessage: 'Conteudo' } }
      }), false);
    }
  },
  {
    name: 'split visual fallback keeps equal aligned columns and uniform content cards',
    run() {
      const plan = __test.normalizeExecutionPlan(
        {
          mode: 'deck',
          slides: [{
            title: 'A Revolucao da IA',
            goal: 'Explicar a transformacao causada pela inteligencia artificial.',
            archetype: 'split-visual',
            imageIntent: 'required',
            contentBrief: {
              keyMessage: 'A inteligencia artificial esta redefinindo como vivemos e trabalhamos.',
              supportingPoints: [
                'Modelos aprendem padroes a partir de grandes volumes de dados.',
                'Automacao e apoio a decisao mudam processos em diferentes setores.'
              ],
              example: 'Assistentes interpretam comandos por processamento de linguagem natural.',
              takeaway: 'Um salto tecnologico comparavel a Revolucao Industrial.'
            }
          }]
        },
        'Crie um slide sobre a revolucao da IA',
        [{ id: 'slide-atual', title: 'Atual', elements: [] }],
        'slide-atual'
      );
      const item = plan.slides[0];
      const actions = __test.buildSafeArchetypeFallbackActions(
        [],
        'Crie um slide sobre a revolucao da IA',
        [],
        item,
        plan,
        { width: 1280, height: 720 }
      );
      const elements = actions.filter((action) => action.type === 'add_element').map((action) => action.element);
      const title = elements.find((element) => element.layoutRole === undefined && element.type === 'text');
      const header = elements.find((element) => element.content?.includes('salto tecnologico'));
      const visual = elements.find((element) => element.type === 'image');
      const leftCards = elements.filter((element) =>
        element.type === 'block'
        && element.x === 64
        && element.y >= 196
      );
      assert.ok(title && header && visual);
      assert.deepEqual([title.x, title.y, title.width, title.height], [64, 64, 560, 104]);
      assert.deepEqual([header.x, header.y, header.width, header.height], [656, 64, 560, 104]);
      assert.deepEqual([visual.x, visual.y, visual.width, visual.height], [656, 196, 560, 396]);
      assert.ok(leftCards.length >= 2);
      assert.equal(new Set(leftCards.map((element) => element.width)).size, 1);
      assert.equal(new Set(leftCards.map((element) => element.height)).size, 1);
      assert.deepEqual(
        __test.collectActionQualityIssues(actions, [], { width: 1280, height: 720 }, item),
        []
      );
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
