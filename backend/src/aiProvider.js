const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { decryptApiKey } = require('./aiConfigCrypto');

const DEFAULT_SYSTEM_PROMPT =
  'Voce e um assistente especializado em montar slides interativos. Responda somente JSON valido.';
const DEFAULT_IMAGE_PROVIDER = {
  providerKey: 'google-gemini-image',
  providerLabel: 'Nano Banana',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-2.5-flash-image'
};

const ALLOWED_ACTIONS = new Set([
  'add_slide',
  'update_slide',
  'delete_slide',
  'add_element',
  'update_element',
  'delete_element',
  'select_element'
]);

const ALLOWED_ELEMENT_TYPES = new Set([
  'text',
  'block',
  'image',
  'audio',
  'video',
  'camera',
  'quiz',
  'floatingButton',
  'detector',
  'input',
  'timedTrigger'
]);

const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
const DEFAULT_SLIDE_FLOW_TITLES = ['Introducao', 'Descoberta', 'Desafio'];
const MAX_SUMMARIZED_SLIDES = 12;
const MAX_SUMMARIZED_ELEMENTS_PER_SLIDE = 6;
const MAX_SUMMARIZED_LABEL_LENGTH = 48;
const MAX_REQUEST_LENGTH = 1800;
const MAX_ATTACHMENT_INSIGHTS_LENGTH = 600;
const MAX_STEPWISE_ACTIONS = 12;
const MAX_PLAN_SLIDES = 12;
const MAX_PROVIDER_MESSAGE_CHARS = 40000;
const MAX_PROVIDER_TOTAL_CHARS = 120000;
const MAX_REPAIR_ECHO_CHARS = 12000;
const MAX_TEMPLATE_REFERENCES = 2;
const MAX_TEMPLATE_SLIDES_PER_REFERENCE = 4;
const TEMPLATE_STORE_DIR = path.resolve(__dirname, '../../template-store');
const TEMPLATE_REFERENCE_CACHE_TTL_MS = 30000;
const MAGIC_PEN_ALLOWED_ROUTES = new Set(['image', 'functional', 'functional_image']);
const TEMPLATE_TRIGGER_ACTION_TYPES = [
  'none',
  'nextSlide',
  'jumpSlide',
  'redirect',
  'addText',
  'replaceText',
  'addImage',
  'addAudio',
  'addVideo',
  'addQuiz',
  'playAudio',
  'pauseVideo',
  'playVideo',
  'seekVideo',
  'showElement',
  'hideElement',
  'moveElement',
  'playAnimation'
];
const TEMPLATE_ANIMATION_TYPES = [
  'none',
  'fade-in',
  'fade-out',
  'slide-left',
  'slide-right',
  'rotate-in',
  'pulse',
  'float',
  'zoom-in',
  'motion-recording'
];
const templateReferenceCache = {
  expiresAt: 0,
  entries: []
};
// const BASIC_LAYOUT_RULES = [
//   'Responda apenas com JSON valido.',
//   'Retorne um array de acoes.',
//   'Retorne somente a estrutura pedida, sem markdown e sem explicacoes fora do JSON.',
//   'Use somente os tipos de acao e elementos permitidos.',
//   'Use somente os campos e comportamentos que ja existem na plataforma. Nao invente ferramentas, propriedades, componentes, HTML, CSS, DOM ou codigo.',
//   'Nunca descreva a solucao como mudanca de HTML. Sempre pense em acoes do editor e propriedades do estado dos slides.',

//   // 🎯 REGRA PRINCIPAL (CRITICA)
//   'O layout deve ser limpo, organizado e legivel. Slides feios, amontoados ou desorganizados sao INVALIDOS.',

//   // 📐 LIMITES DO PALCO
//   'O palco e 1280x720 e funciona como limite RIGIDO.',
//   'Use o palco 1280x720 como limite absoluto.',
//   'Nenhum elemento pode ultrapassar esse limite em nenhuma direcao.',
//   'Todos os elementos devem caber 100% dentro do palco.',
//   'Considere margens de seguranca (minimo 24px das bordas).',

//   // 🧱 ORGANIZACAO VISUAL
//   'Nao empilhe elementos aleatoriamente.',
//   'Nao sobreponha elementos sem motivo claro.',
//   'Evite poluicao visual.',

//   'Use estrutura previsivel:',
//   '- Topo: titulo',
//   '- Meio: conteudo',
//   '- Base: interacao',

//   'Distribua bem o espaco. Nao concentre tudo em um lado.',
//   'Se houver elementos grandes, use colunas ou secoes.',

//   // 📏 ESPACAMENTO
//   'Use no minimo 24px entre elementos principais.',
//   'Se faltar espaco, REMOVA elementos — nao aperte tudo.',

//   // 🔠 TEXTO
//   'Texto nunca pode vazar do box.',
//   'Sempre ajustar width, height e fontSize juntos.',
//   'Texto longo precisa de mais espaco ou fonte menor.',
//   'Titulo: grande e curto. Paragrafo: menor e mais area.',

//   // 🧩 HIERARQUIA
//   'Deixe claro titulo, subtitulo e conteudo.',
//   'Titulo deve ter mais destaque.',
//   'Nao use tudo com o mesmo peso visual.',

//   // 🎨 CORES
//   'Use paleta consistente (primaria, secundaria e destaque).',
//   'Nao usar cores aleatorias.',
//   'Manter harmonia entre fundo, blocos e textos.',
//   'Garantir contraste alto.',
//   'Se fundo for complexo, usar block para leitura.',

//   // 🎯 FUNDO DO SLIDE (CRITICO)
//   'O slide nunca pode ficar sem fundo.',
//   'Sempre usar backgroundColor ou backgroundImage.',

//   'Nao usar imagem de fundo com texto direto.',
//   'Se houver texto, nao colocar sobre imagem de fundo.',

//   'Use layout separado (imagem + texto) ou block com fundo solido.',

//   'Se usar imagem de fundo, ela deve ser limpa e sem ruido.',
//   'Se for complexa, usar como elemento separado.',

//   'Se houver imagem anexada, NAO usar automaticamente como fundo.',
//   'Se houver texto, nao usar imagem anexada como fundo.',

//   'Nunca sacrificar legibilidade por estetica.',

//   // 🖼️ IMAGENS
//   'Usar imagem quando ajudar na explicacao.',
//   'Use imagens também como decorativas.',
//   'Preferir generationPrompt para imagens novas.',

//   // 🧱 BLOCK
//   'Usar block para dar fundo a textos importantes.',
//   'Nao deixar texto solto sobre imagem.',

//   // 🚫 ERROS GRAVES
//   'Nao sobrepor quiz.',
//   'Nao colocar botao sobre texto importante.',
//   'Nao criar elementos ilegiveis.',

//   // 🔘 BOTÕES
//   'FloatingButton deve ter funcao real.',
//   'Nao criar botao inutil.',
//   'Botao deve ser visivel e clicavel.',

//   // 🧪 QUIZ (CRITICO)
//   'Tamanho minimo do quiz é de (min 400px de largura e 350px de altura). então sempre considere isso no layout.',
//   'Evitar quiz fixo com muito conteudo.',
//   'Preferir quiz via botao (addQuiz).',

//   'NUNCA Usar quiz fixo apenas quando solicitado. Opte por quiz via botao',
//   'Nunca sobrepor quiz.',

//   'Se usar botao para quiz, preencher tudo:',
//   'quizQuestion, quizOptions, quizCorrectOption, successMessage, errorMessage, actionLabel.',

//   'quizOptions deve ser array de strings.',
//   'Nunca criar quiz incompleto.',
//   'Jamais colocar um quiz em cima de um texto ou bloco com informacao importante. O quiz deve ter seu proprio espaco dedicado no layout.',


//   // 🧲 DETECTOR
//   'Detector é invisivel.',
//   'Sempre usar elemento visual junto.',

//   'Se houver detector, deve existir elemento arrastavel.',
//   'Elemento arrastavel deve ter studentCanDrag true.',
//   'O detector sempre tem que ter uma ação clara (encaixe, acerto, colisao ou validacao).',
//   'Nao criar detector sem interacao real.',

//   // 🎮 INTERATIVIDADE
//   'Para aulas interativas, usar detector e arrastar.',
//   'Preferir imagens arrastaveis com sentido pedagogico.',
//   'Interacao deve ser clara e intuitiva.',
//   'Use botões com ações claras para interatividade, como adicionar quiz ou navegar entre slides.',

//   // 🔁 ACOES
//   'add_element exige slideId e element.',
//   'update_element exige slideId, elementId e dados.',
//   'add_slide exige id ou title.',
//   'Nao criar acoes vazias.',

//   'Nao inventar IDs.',
//   'Criar slide antes de adicionar elementos.',

//   // 🎬 ANIMACOES
//   'Usar animacoes com moderacao.',
//   'Nao animar muitos elementos.',

//   // 🧩 REGRA FINAL
//   'Antes de responder, valide:',
//   '- Layout organizado?',
//   '- Legivel?',
//   '- Tem espaco?',
//   '- Fundo correto?',
//   '- Sem texto em imagem de fundo?',
//   '- Quiz bem usado?',
//   '- Detector com arrastar?',
//   '- Parece profissional?',

//   'Se algo estiver errado, refaca o layout.'
// ];
const BASIC_LAYOUT_RULES = [
  'Responda apenas com JSON valido.',
  'O palco tem 1280x720px. Limite rigido: x entre 0 e 1280, y entre 0 e 720.',
  'Margem segura recomendada: 24px de cada borda.',
  'Para criar elementos, use "add_element". Para slides, "add_slide".',
  'Nunca invente IDs. Use IDs descritivos em minusculas (ex: titulo-principal).',
  'Para texto, defina sempre: x, y, width, height, fontSize, textColor e content.',
  'Para imagens, prefira "generationPrompt" em vez de URL externa.',
  'floatingButton exige "actionConfig" com "type" valido (ex: nextSlide, jumpSlide, addText).',
  'Quiz precisa de: question, options (array de strings), correctOption (numero).',
  'Se o pedido for simples, faca a acao minima necessaria. Nao crie slides extras nao solicitados.'
];
const ELEMENT_CONFIGURATION_RULES = [
  'Quando o pedido mencionar animacao, nao basta inserir o elemento: configure animationType e, quando fizer sentido, animationDuration, animationDelay, animationLoop ou motionFrames.',
  'Quando o pedido mencionar botao, CTA ou clique, nao basta inserir floatingButton: configure interactionTriggers ou actionConfig funcional com type e campos coerentes com a acao pedida.',
  'Quando o pedido mencionar botao, a resposta final precisa realmente usar type floatingButton. Nao substitua um botao funcional por block, card ou faixa colorida.',
  'Quando o pedido mencionar detector, encaixe, colisao, arraste ou validacao por area, nao basta inserir detector: configure interactionTriggers/actionConfig, detectorAcceptedDrag, detectorMinMatchCount e detectorTriggerOnce quando necessario.',
  'Quando o pedido mencionar quiz, avaliacao ou pergunta interativa, nao basta inserir quiz: preencha question, options, correctOption, successMessage, errorMessage, actionLabel, points, lockOnWrong e cores quando o pedido sugerir estilo.',
  'Quando o pedido mencionar campo, formulario, resposta do aluno, envio, anexo, digitacao ou validacao de resposta, prefira type input com placeholder, submitLabel, compareText/compareImage e gatilhos configurados.',
  'Quando o pedido mencionar mostrar, esconder, mover, tocar animacao, navegar ou inserir conteudo ao clicar, use os campos de configuracao apropriados do elemento em vez de deixar o comportamento implicito.',
  'Quando o pedido for ajustar um elemento existente, prefira update_element com os campos corretos em vez de criar outro elemento solto.',
  'Quando houver imagem/anexo com seta, ponteiro ou direcao, preserve o lado para o qual a ponta aponta exatamente como descrito em attachmentSummary.',
  'Quando o pedido mencionar detector, hotspot, botao, quiz, input, arrastar, encaixe ou outro recurso funcional da plataforma, trate o anexo apenas como referencia de area, posicao, tamanho e direcao. Nao transforme automaticamente o rabisco em block ou image por causa da cor ou da forma literal.',
  'Se o pedido pedir detector, a resposta final precisa realmente usar type detector. Se pedir quiz, use type quiz. Se pedir botao, use floatingButton com configuracao funcional. Se pedir campo de resposta, use input configurado.'
];

function requestTargetsFunctionalPlatformElement(request) {
  return /(detector|hotspot|area invisivel|área invisível|gatilho|encaixe|drop|drag|arrast|quiz|pergunta interativa|botao|botão|cta|clicar|click|input|campo|naveg|floatingbutton|nextslide|jumpslide)/i.test(
    String(request || '')
  );
}
function requestExplicitlyTargetsArrowLikeObject(request) {
  return /(seta|flecha|arrow|ponteiro|indicador direcional|apontando|apontar)/i.test(String(request || ''));
}

function normalizeReferenceText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenizeReferenceText(value = '') {
  return Array.from(
    new Set(
      normalizeReferenceText(value)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3)
    )
  );
}

function summarizeTemplateTriggerKinds(element = {}) {
  const triggerSet = new Set();
  const interactionTriggers = Array.isArray(element.interactionTriggers) ? element.interactionTriggers : [];
  interactionTriggers.forEach((trigger) => {
    const type = String(trigger?.actionConfig?.type || '').trim();
    if (type) {
      triggerSet.add(type);
    }
  });
  const videoTriggers = Array.isArray(element.videoTriggers) ? element.videoTriggers : [];
  videoTriggers.forEach((trigger) => {
    const type = String(trigger?.actionConfig?.type || '').trim();
    if (type) {
      triggerSet.add(`video:${type}`);
    }
  });
  if (element.actionConfig?.type) {
    triggerSet.add(String(element.actionConfig.type).trim());
  }
  return Array.from(triggerSet).slice(0, 6);
}

function inferTemplateSlideArchetype(slide = {}) {
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  const counts = elements.reduce((acc, element) => {
    const key = String(element?.type || '').trim();
    if (key) {
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, {});
  if (counts.detector) {
    return 'drag-drop';
  }
  if (counts.quiz) {
    return 'quiz';
  }
  if (counts.video) {
    return 'video';
  }
  if ((counts.image || 0) >= 1 && (counts.text || 0) >= 2) {
    return 'hero';
  }
  if ((counts.block || 0) >= 3) {
    return 'cards';
  }
  if ((counts.floatingButton || 0) >= 2) {
    return 'guided-navigation';
  }
  return 'content';
}

function summarizeTemplateSlideReference(slide = {}, index = 0) {
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  const counts = elements.reduce((acc, element) => {
    const key = String(element?.type || '').trim();
    if (key) {
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, {});
  const triggerKinds = Array.from(
    new Set(elements.flatMap((element) => summarizeTemplateTriggerKinds(element)))
  ).slice(0, 8);
  return {
    order: index + 1,
    title: truncateText(slide.title || `Slide ${index + 1}`, 60),
    archetype: inferTemplateSlideArchetype(slide),
    elementCounts: counts,
    hasGradientBackground: Boolean(
      slide.backgroundFillType === 'gradient' || slide.backgroundGradientStart || slide.backgroundGradientEnd
    ),
    hasImageBackground: Boolean(slide.backgroundImage),
    draggableCount: elements.filter((element) => element?.studentCanDrag).length,
    triggerKinds,
    highlights: elements
      .slice(0, 4)
      .map((element) => ({
        type: element?.type || '',
        label: truncateText(
          element?.content || element?.label || element?.question || element?.id || element?.type || '',
          44
        )
      }))
  };
}

async function readTemplateReferenceEntries() {
  const now = Date.now();
  if (templateReferenceCache.expiresAt > now && Array.isArray(templateReferenceCache.entries)) {
    return templateReferenceCache.entries;
  }
  let fileNames = [];
  try {
    const dirEntries = await fs.readdir(TEMPLATE_STORE_DIR, { withFileTypes: true });
    fileNames = dirEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort((first, second) => first.localeCompare(second, 'pt-BR'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      templateReferenceCache.entries = [];
      templateReferenceCache.expiresAt = now + TEMPLATE_REFERENCE_CACHE_TTL_MS;
      return [];
    }
    throw error;
  }

  const entries = [];
  for (const fileName of fileNames) {
    try {
      const rawText = await fs.readFile(path.join(TEMPLATE_STORE_DIR, fileName), 'utf8');
      const payload = JSON.parse(rawText);
      const templateSource =
        payload?.kind === 'curso-slide-template'
          ? payload.template
          : payload?.template && (payload.template.builderData || payload.template.builder_data)
            ? payload.template
            : payload;
      const builderData = templateSource?.builderData || templateSource?.builder_data || templateSource;
      const slides = Array.isArray(builderData?.slides) ? builderData.slides : [];
      if (!slides.length) {
        continue;
      }
      const summarizedSlides = slides
        .slice(0, MAX_TEMPLATE_SLIDES_PER_REFERENCE)
        .map((slide, index) => summarizeTemplateSlideReference(slide, index));
      const aggregateCounts = slides.flatMap((slide) => slide?.elements || []).reduce((acc, element) => {
        const key = String(element?.type || '').trim();
        if (key) {
          acc[key] = (acc[key] || 0) + 1;
        }
        return acc;
      }, {});
      const capabilityTags = [];
      if (aggregateCounts.quiz) capabilityTags.push('quiz');
      if (aggregateCounts.detector) capabilityTags.push('drag-drop');
      if (aggregateCounts.video) capabilityTags.push('video');
      if (aggregateCounts.audio) capabilityTags.push('audio');
      if (aggregateCounts.floatingButton) capabilityTags.push('buttons');
      if (slides.some((slide) => (slide?.elements || []).some((element) => element?.studentCanDrag))) capabilityTags.push('draggable');
      if (slides.some((slide) => slide?.backgroundFillType === 'gradient' || slide?.backgroundGradientStart || slide?.backgroundGradientEnd)) {
        capabilityTags.push('gradient-background');
      }
      const textCorpus = [
        fileName.replace(/\.json$/i, ''),
        templateSource?.title || '',
        templateSource?.description || '',
        payload?.store?.category || '',
        payload?.store?.badge || '',
        payload?.store?.summary || '',
        ...summarizedSlides.map((slide) => `${slide.title} ${slide.archetype} ${slide.triggerKinds.join(' ')}`)
      ].join(' ');
      entries.push({
        key: fileName.replace(/\.json$/i, ''),
        title: String(templateSource?.title || '').trim() || fileName.replace(/\.json$/i, ''),
        category: String(payload?.store?.category || '').trim() || 'Geral',
        summary: truncateText(String(payload?.store?.summary || templateSource?.description || '').trim(), 180),
        slideCount: slides.length,
        capabilityTags,
        structureSignature: summarizedSlides.map((slide) => slide.archetype).join(' -> '),
        slides: summarizedSlides,
        searchTokens: tokenizeReferenceText(textCorpus)
      });
    } catch (error) {
      // Ignore malformed template references so generation continues.
    }
  }

  templateReferenceCache.entries = entries;
  templateReferenceCache.expiresAt = now + TEMPLATE_REFERENCE_CACHE_TTL_MS;
  return entries;
}

function scoreTemplateReference(entry, request, executionPlan = null, currentPlanItem = null) {
  const requestTokens = tokenizeReferenceText([
    request,
    currentPlanItem?.title || '',
    currentPlanItem?.goal || '',
    currentPlanItem?.layoutNotes || '',
    currentPlanItem?.interactionNotes || ''
  ].join(' '));
  let score = 0;
  requestTokens.forEach((token) => {
    if (entry.searchTokens.includes(token)) {
      score += token.length > 6 ? 5 : 3;
    }
  });
  const requestedCount = extractRequestedSlideCount(request);
  if (requestedCount && Math.abs(entry.slideCount - requestedCount) <= 2) {
    score += 8;
  }
  if (executionPlan?.mode === 'deck' && Array.isArray(executionPlan.slides) && executionPlan.slides.length) {
    score += Math.max(0, 6 - Math.abs(entry.slideCount - executionPlan.slides.length));
  }
  if (/quiz/i.test(request) && entry.capabilityTags.includes('quiz')) score += 6;
  if (/(arrast|drag|encaix|detector)/i.test(normalizeReferenceText(request)) && entry.capabilityTags.includes('drag-drop')) score += 7;
  if (/(video|youtube)/i.test(normalizeReferenceText(request)) && entry.capabilityTags.includes('video')) score += 5;
  if (/(audio|som|narra)/i.test(normalizeReferenceText(request)) && entry.capabilityTags.includes('audio')) score += 4;
  if (/(boto|button|cta|navega)/i.test(normalizeReferenceText(request)) && entry.capabilityTags.includes('buttons')) score += 4;
  return score;
}

async function buildTemplateReferenceContext({ request, executionPlan = null, currentPlanItem = null }) {
  const catalog = await readTemplateReferenceEntries();
  if (!catalog.length) {
    return null;
  }
  const ranked = catalog
    .map((entry) => ({
      ...entry,
      matchScore: scoreTemplateReference(entry, request, executionPlan, currentPlanItem)
    }))
    .filter((entry) => entry.matchScore > 0)
    .sort((first, second) => second.matchScore - first.matchScore)
    .slice(0, MAX_TEMPLATE_REFERENCES)
    .map((entry) => ({
      key: entry.key,
      title: entry.title,
      category: entry.category,
      summary: entry.summary,
      slideCount: entry.slideCount,
      capabilityTags: entry.capabilityTags,
      structureSignature: entry.structureSignature,
      slides: entry.slides,
      currentSlideHint:
        currentPlanItem?.order && entry.slides[currentPlanItem.order - 1]
          ? entry.slides[currentPlanItem.order - 1]
          : null
    }));
  return ranked.length ? ranked : null;
}

function createAiCapabilityCatalog() {
  return {
    stage: DEFAULT_STAGE_SIZE,
    slideFields: ['id', 'title', 'backgroundColor', 'backgroundImage', 'backgroundImagePrompt'],
    actionTypes: Array.from(ALLOWED_ACTIONS),
    animationTypes: TEMPLATE_ANIMATION_TYPES,
    triggerActionTypes: TEMPLATE_TRIGGER_ACTION_TYPES,
    detectorAcceptedDragExamples: ['any', 'type:image', 'type:text', 'element:element-id'],
    usagePlaybook: {
      text: 'Use text para conteudo visivel. Configure content, x, y, width, height, fontSize, textColor, textAlign e estilos de fundo/borda quando o prompt pedir destaque ou card textual.',
      block: 'Use block para estrutura visual, cards, faixas, caixas de destaque e textos em containers. Configure shape, backgroundColor ou gradiente, textColor e dimensoes reais.',
      image: 'Use image com generationPrompt quando o pedido exigir ilustracao, objeto, personagem, icone, seta desenhada, foto ou visual especifico. Defina x, y, width e height coerentes com o palco.',
      camera: 'Use camera quando o pedido precisar transmitir webcam no proprio palco antes de capturar uma foto ou gravar um video. Defina x, y, width e height reais.',
      floatingButton: 'Use floatingButton quando houver CTA, clique, navegacao ou acao manual. Nunca substitua botao por block colorido. Configure interactionTriggers/actionConfig completo, com type funcional e todos os campos exigidos para essa acao.',
      detector: 'Use detector como area invisivel de encaixe/colisao/validacao. Combine com elemento visual de apoio e, em interacoes de arrastar, configure detectorAcceptedDrag e studentCanDrag no item arrastavel.',
      input: 'Use input para resposta digitada, envio de texto, anexo de imagem/audio ou validacao de resposta do aluno. Configure placeholder, submitLabel, compareText/compareImage, mensagens e interactionTriggers.',
      timedTrigger: 'Use timedTrigger quando a interacao depender de tempo automatico. Configure interactionTriggers com time e actionConfig reais.',
      quiz: 'Use quiz quando o usuario pedir pergunta ou avaliacao pronta no slide. Preencha question, options, correctOption, mensagens, actionLabel, points, lockOnWrong e cores do quiz.',
      animation: 'Quando o prompt pedir animacao, escolha animationType intencional e complemente com animationDuration, animationDelay, animationLoop ou motionFrames. Nao deixe animacao subentendida.'
    },
    configurationRecipes: [
      'Botao para navegar: floatingButton + interactionTriggers/actionConfig.type nextSlide ou jumpSlide + targetSlideId.',
      'Botao para inserir quiz: floatingButton + actionConfig.type addQuiz + quizQuestion + quizOptions + quizCorrectOption + mensagens + cores.',
      'Botao para gerar imagem ao clicar: floatingButton + actionConfig.type addImage + generationPrompt + insertX + insertY + insertWidth + insertHeight.',
      'Campo de resposta: input + placeholder + submitLabel + compareText ou compareImageReference + successMessage + errorMessage + interactionTriggers.',
      'Elemento arrastavel com encaixe: image/text/block com studentCanDrag true + detector com actionConfig funcional e detectorAcceptedDrag apropriado.',
      'Animacao personalizada: image/text/block/floatingButton com animationType motion-recording e motionFrames progressivos.',
      'Mover elemento: floatingButton ou detector com actionConfig.type moveElement + targetElementId + moveByX/moveByY.',
      'Disparar animacao existente: floatingButton ou detector com actionConfig.type playAnimation + targetElementId.'
    ],
    elementTypes: {
      text: ['content', 'x', 'y', 'width', 'height', 'fontSize', 'fontFamily', 'fontWeight', 'textColor', 'textAlign', 'backgroundColor', 'hasTextBackground', 'hasTextBorder', 'hasTextBlock', 'studentCanDrag', 'opacity', 'animationType', 'animationDuration', 'animationDelay', 'animationLoop', 'motionFrames'],
      block: ['content', 'x', 'y', 'width', 'height', 'shape', 'backgroundColor', 'solidColor', 'useGradient', 'gradientStart', 'gradientEnd', 'textColor', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign', 'textureImage', 'textureFit', 'studentCanDrag', 'opacity', 'animationType', 'motionFrames'],
      image: ['src', 'generationPrompt', 'x', 'y', 'width', 'height', 'objectFit', 'studentCanDrag', 'opacity', 'animationType', 'motionFrames'],
      audio: ['src', 'x', 'y', 'width', 'height', 'audioVisible', 'audioLoop', 'opacity'],
      video: ['src', 'provider', 'embedSrc', 'x', 'y', 'width', 'height', 'opacity', 'videoTriggers'],
      camera: ['x', 'y', 'width', 'height', 'opacity'],
      quiz: ['question', 'options', 'correctOption', 'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor', 'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'points', 'lockOnWrong', 'x', 'y', 'width', 'height'],
      floatingButton: ['label', 'x', 'y', 'width', 'height', 'shape', 'backgroundColor', 'solidColor', 'useGradient', 'gradientStart', 'gradientEnd', 'textColor', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign', 'opacity', 'animationType', 'interactionTriggers'],
      detector: ['x', 'y', 'width', 'height', 'interactionTriggers'],
      input: ['x', 'y', 'width', 'height', 'placeholder', 'submitLabel', 'compareText', 'compareCaseSensitive', 'compareImageEnabled', 'compareImageReference', 'allowImage', 'allowAudio', 'successMessage', 'errorMessage', 'backgroundColor', 'labelColor', 'inputTextColor', 'submitButtonColor', 'submitButtonTextColor', 'interactionTriggers'],
      timedTrigger: ['x', 'y', 'width', 'height', 'interactionTriggers']
    },
    triggerSchemas: {
      interactionTrigger: ['id', 'name', 'enabled', 'actionConfig'],
      videoTrigger: ['id', 'name', 'enabled', 'time', 'actionConfig'],
      actionConfig: ['type', 'targetSlideId', 'targetElementId', 'text', 'url', 'generationPrompt', 'insertX', 'insertY', 'insertWidth', 'insertHeight', 'moveByX', 'moveByY', 'moveDuration', 'videoTime', 'replaceMode', 'replaceText', 'replaceCounterStart', 'replaceCounterStep', 'quizQuestion', 'quizOptions', 'quizCorrectOption', 'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor', 'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'points', 'lockOnWrong', 'audioVisible', 'audioLoop', 'playSourceVideoOnValidate', 'detectorAcceptedDrag', 'detectorMinMatchCount', 'detectorTriggerOnce', 'requireAllButtonsInGroup', 'ruleGroup', 'textColor', 'backgroundColor', 'textAlign', 'fontFamily', 'fontWeight', 'fontSize', 'hasTextBackground', 'hasTextBorder', 'hasTextBlock']
    }
  };
}

function buildPublicAiSettings(row, options = {}) {
  const includeCreditCost = options.includeCreditCost !== false;
  if (!row) {
    const payload = {
      connected: false,
      providerKey: 'deepseek',
      providerLabel: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      systemPrompt: '',
      requireConfirmation: true,
      isEnabled: false,
      hasApiKey: false
      ,
      imageProvider: {
        connected: false,
        providerKey: DEFAULT_IMAGE_PROVIDER.providerKey,
        providerLabel: DEFAULT_IMAGE_PROVIDER.providerLabel,
        baseUrl: DEFAULT_IMAGE_PROVIDER.baseUrl,
        model: DEFAULT_IMAGE_PROVIDER.model,
        isEnabled: false,
        hasApiKey: false
      }
    };
    if (includeCreditCost) {
      payload.aiCreditCostPerCall = 0.5;
    }
    return payload;
  }
  const payload = {
    connected: true,
    providerKey: row.provider_key,
    providerLabel: row.provider_label,
    baseUrl: row.base_url,
    model: row.model,
    systemPrompt: row.system_prompt || '',
    requireConfirmation: row.require_confirmation !== false,
    isEnabled: row.is_enabled !== false,
    hasApiKey: Boolean(row.encrypted_api_key),
    updatedAt: row.updated_at,
    imageProvider: {
      connected: Boolean(row.image_encrypted_api_key),
      providerKey: row.image_provider_key || DEFAULT_IMAGE_PROVIDER.providerKey,
      providerLabel: row.image_provider_label || DEFAULT_IMAGE_PROVIDER.providerLabel,
      baseUrl: row.image_base_url || DEFAULT_IMAGE_PROVIDER.baseUrl,
      model: row.image_model || DEFAULT_IMAGE_PROVIDER.model,
      isEnabled: row.image_is_enabled !== false,
      hasApiKey: Boolean(row.image_encrypted_api_key)
    }
  };
  if (includeCreditCost) {
    payload.aiCreditCostPerCall = Number.isFinite(Number(row.ai_credit_cost_per_call))
      ? Math.max(0.01, Number(row.ai_credit_cost_per_call))
      : 0.5;
  }
  return payload;
}

function normalizeImageAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const mimeType = String(entry.mimeType || '').trim().toLowerCase();
      const data = String(entry.data || '').trim();
      const name = String(entry.name || `imagem-${index + 1}`).trim();
      if (!mimeType.startsWith('image/') || !data) {
        return null;
      }
      return { mimeType, data, name };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeActionList(value) {
  if (!Array.isArray(value)) {
    throw new Error('A resposta da IA precisa ser uma lista de ações.');
  }
  return value.map((entry, index) => normalizeSingleAction(entry, index));
}

function normalizeActionTypeAlias(value) {
  const normalized = String(value || '').trim();
  const aliases = {
    addSlide: 'add_slide',
    replaceSlide: 'update_slide',
    replace_slide: 'update_slide',
    updateSlide: 'update_slide',
    editSlide: 'update_slide',
    edit_slide: 'update_slide',
    deleteSlide: 'delete_slide',
    addElement: 'add_element',
    updateElement: 'update_element',
    replaceElement: 'update_element',
    replace_element: 'update_element',
    editElement: 'update_element',
    edit_element: 'update_element',
    deleteElement: 'delete_element',
    selectElement: 'select_element'
  };
  return aliases[normalized] || normalized;
}

function collectTopLevelSlidePatch(entry = {}) {
  const patch = {};
  ['id', 'title', 'backgroundImage', 'backgroundColor', 'backgroundImagePrompt'].forEach((key) => {
    if (key in entry) {
      patch[key] = entry[key];
    }
  });
  return patch;
}

function collectTopLevelElementPatch(entry = {}) {
  const patch = {};
  const elementType =
    typeof entry.elementType === 'string' && entry.elementType.trim()
      ? entry.elementType.trim()
      : typeof entry.targetType === 'string' && entry.targetType.trim()
        ? entry.targetType.trim()
        : '';
  if (elementType) {
    patch.type = elementType;
  }
  [
    'id', 'content', 'label', 'src', 'generationPrompt', 'provider', 'embedSrc', 'shape', 'animationType',
    'textColor', 'fontFamily', 'fontWeight', 'backgroundColor', 'solidColor', 'gradientStart', 'gradientEnd',
    'useGradient', 'hasTextBackground', 'hasTextBorder', 'hasTextBlock', 'studentCanDrag', 'question',
    'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor',
    'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'lockOnWrong',
    'animationLoop', 'motionFrames', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'fontSize',
    'correctOption', 'animationDuration', 'animationDelay', 'points', 'options', 'actionConfig',
    'textAlign', 'opacity', 'objectFit', 'textureImage', 'textureFit', 'audioVisible', 'audioLoop',
    'interactionTriggers', 'videoTriggers', 'placeholder', 'submitLabel', 'compareText', 'compareCaseSensitive',
    'compareImageEnabled', 'compareImageReference', 'allowImage', 'allowAudio', 'labelColor', 'inputTextColor',
    'submitButtonColor', 'submitButtonTextColor'
  ].forEach((key) => {
    if (key in entry) {
      patch[key] = entry[key];
    }
  });
  return patch;
}

function normalizeSingleAction(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Ação ${index + 1} inválida.`);
  }
  const type = normalizeActionTypeAlias(entry.type);
  if (!ALLOWED_ACTIONS.has(type)) {
    throw new Error(`Ação ${index + 1} usa um tipo não permitido: ${type || 'vazio'}.`);
  }
  const normalized = {
    type,
    reason: typeof entry.reason === 'string' ? entry.reason.trim() : ''
  };
  if (typeof entry.slideId === 'string' && entry.slideId.trim()) {
    normalized.slideId = entry.slideId.trim();
  }
  if (typeof entry.elementId === 'string' && entry.elementId.trim()) {
    normalized.elementId = entry.elementId.trim();
  }
  if (typeof entry.afterSlideId === 'string' && entry.afterSlideId.trim()) {
    normalized.afterSlideId = entry.afterSlideId.trim();
  }
  if (typeof entry.setActive === 'boolean') {
    normalized.setActive = entry.setActive;
  }
  if (entry.slide && typeof entry.slide === 'object') {
    normalized.slide = normalizeSlidePatch(entry.slide);
  } else if (['add_slide', 'update_slide'].includes(type)) {
    const topLevelSlidePatch = collectTopLevelSlidePatch(entry);
    if (Object.keys(topLevelSlidePatch).length) {
      normalized.slide = normalizeSlidePatch(topLevelSlidePatch);
    }
  }
  if (entry.element && typeof entry.element === 'object') {
    normalized.element = normalizeElementPatch(entry.element);
  } else if (['add_element', 'update_element'].includes(type)) {
    const topLevelElementPatch = collectTopLevelElementPatch(entry);
    if (Object.keys(topLevelElementPatch).length) {
      normalized.element = normalizeElementPatch(topLevelElementPatch);
    }
  }
  return normalized;
}

function normalizeSlidePatch(slide) {
  const normalized = {};
  if (typeof slide.id === 'string' && slide.id.trim()) {
    normalized.id = slide.id.trim();
  }
  if (typeof slide.title === 'string') {
    normalized.title = slide.title.trim() || 'Novo slide';
  }
  if (slide.backgroundImage === null || typeof slide.backgroundImage === 'string') {
    normalized.backgroundImage = slide.backgroundImage ? slide.backgroundImage.trim() : null;
  }
  if (typeof slide.backgroundColor === 'string' && slide.backgroundColor.trim()) {
    normalized.backgroundColor = slide.backgroundColor.trim();
  }
  if (typeof slide.backgroundImagePrompt === 'string' && slide.backgroundImagePrompt.trim()) {
    normalized.backgroundImagePrompt = slide.backgroundImagePrompt.trim();
  }
  return normalized;
}

function normalizeStringList(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item && typeof item === 'object') {
        const candidates = [item.text, item.label, item.content, item.value, item.option];
        const match = candidates.find((entry) => typeof entry === 'string' && entry.trim());
        if (match) {
          return match.trim();
        }
      }
      return String(item ?? `Opcao ${index + 1}`).trim();
    })
    .filter(Boolean);
}

function normalizeElementPatch(element) {
  const normalized = {};
  if (typeof element.id === 'string' && element.id.trim()) {
    normalized.id = element.id.trim();
  }
  if (typeof element.type === 'string' && ALLOWED_ELEMENT_TYPES.has(element.type.trim())) {
    normalized.type = element.type.trim();
  }
  if (typeof element.content === 'string') normalized.content = element.content;
  if (typeof element.label === 'string') normalized.label = element.label;
  if (typeof element.src === 'string') normalized.src = element.src.trim();
  if (typeof element.generationPrompt === 'string') normalized.generationPrompt = element.generationPrompt.trim();
  if (typeof element.provider === 'string') normalized.provider = element.provider.trim();
  if (typeof element.embedSrc === 'string') normalized.embedSrc = element.embedSrc.trim();
  if (typeof element.shape === 'string') normalized.shape = element.shape.trim();
  if (typeof element.animationType === 'string') normalized.animationType = element.animationType.trim();
  if (typeof element.textColor === 'string') normalized.textColor = element.textColor.trim();
  if (typeof element.fontFamily === 'string') normalized.fontFamily = element.fontFamily;
  if (typeof element.fontWeight === 'string') normalized.fontWeight = element.fontWeight;
  if (typeof element.textAlign === 'string') normalized.textAlign = element.textAlign.trim();
  if (typeof element.backgroundColor === 'string') normalized.backgroundColor = element.backgroundColor.trim();
  if (typeof element.solidColor === 'string') normalized.solidColor = element.solidColor.trim();
  if (typeof element.gradientStart === 'string') normalized.gradientStart = element.gradientStart.trim();
  if (typeof element.gradientEnd === 'string') normalized.gradientEnd = element.gradientEnd.trim();
  if (typeof element.useGradient === 'boolean') normalized.useGradient = element.useGradient;
  if (typeof element.opacity === 'number' || Number.isFinite(Number(element.opacity))) normalized.opacity = Number(element.opacity);
  if (typeof element.objectFit === 'string') normalized.objectFit = element.objectFit.trim();
  if (typeof element.textureImage === 'string') normalized.textureImage = element.textureImage.trim();
  if (typeof element.textureFit === 'string') normalized.textureFit = element.textureFit.trim();
  if (typeof element.audioVisible === 'boolean') normalized.audioVisible = element.audioVisible;
  if (typeof element.audioLoop === 'boolean') normalized.audioLoop = element.audioLoop;
  if (typeof element.hasTextBackground === 'boolean') normalized.hasTextBackground = element.hasTextBackground;
  if (typeof element.hasTextBorder === 'boolean') normalized.hasTextBorder = element.hasTextBorder;
  if (typeof element.hasTextBlock === 'boolean') normalized.hasTextBlock = element.hasTextBlock;
  if (typeof element.studentCanDrag === 'boolean') normalized.studentCanDrag = element.studentCanDrag;
  if (typeof element.question === 'string') normalized.question = element.question;
  if (typeof element.placeholder === 'string') normalized.placeholder = element.placeholder;
  if (typeof element.submitLabel === 'string') normalized.submitLabel = element.submitLabel;
  if (typeof element.compareText === 'string') normalized.compareText = element.compareText;
  if (typeof element.successMessage === 'string') normalized.successMessage = element.successMessage;
  if (typeof element.errorMessage === 'string') normalized.errorMessage = element.errorMessage;
  if (typeof element.actionLabel === 'string') normalized.actionLabel = element.actionLabel;
  if (typeof element.quizBackgroundColor === 'string') normalized.quizBackgroundColor = element.quizBackgroundColor.trim();
  if (typeof element.quizQuestionColor === 'string') normalized.quizQuestionColor = element.quizQuestionColor.trim();
  if (typeof element.quizOptionBackgroundColor === 'string') normalized.quizOptionBackgroundColor = element.quizOptionBackgroundColor.trim();
  if (typeof element.quizOptionTextColor === 'string') normalized.quizOptionTextColor = element.quizOptionTextColor.trim();
  if (typeof element.quizButtonBackgroundColor === 'string') normalized.quizButtonBackgroundColor = element.quizButtonBackgroundColor.trim();
  if (typeof element.compareImageReference === 'string') normalized.compareImageReference = element.compareImageReference.trim();
  if (typeof element.labelColor === 'string') normalized.labelColor = element.labelColor.trim();
  if (typeof element.inputTextColor === 'string') normalized.inputTextColor = element.inputTextColor.trim();
  if (typeof element.submitButtonColor === 'string') normalized.submitButtonColor = element.submitButtonColor.trim();
  if (typeof element.submitButtonTextColor === 'string') normalized.submitButtonTextColor = element.submitButtonTextColor.trim();
  if (typeof element.lockOnWrong === 'boolean') normalized.lockOnWrong = element.lockOnWrong;
  if (typeof element.animationLoop === 'boolean') normalized.animationLoop = element.animationLoop;
  if (typeof element.compareCaseSensitive === 'boolean') normalized.compareCaseSensitive = element.compareCaseSensitive;
  if (typeof element.compareImageEnabled === 'boolean') normalized.compareImageEnabled = element.compareImageEnabled;
  if (typeof element.allowImage === 'boolean') normalized.allowImage = element.allowImage;
  if (typeof element.allowAudio === 'boolean') normalized.allowAudio = element.allowAudio;
  if (Array.isArray(element.motionFrames)) {
    normalized.motionFrames = element.motionFrames
      .filter((frame) => frame && typeof frame === 'object')
      .map((frame) => {
        const normalizedFrame = {};
        ['x', 'y', 'width', 'height', 'rotation', 'opacity'].forEach((key) => {
          if (Number.isFinite(Number(frame[key]))) {
            normalizedFrame[key] = Number(frame[key]);
          }
        });
        return normalizedFrame;
      })
      .filter((frame) => Object.keys(frame).length > 0);
  }
  ['x', 'y', 'width', 'height', 'rotation', 'zIndex', 'fontSize', 'correctOption', 'animationDuration', 'animationDelay'].forEach((key) => {
    if (Number.isFinite(Number(element[key]))) {
      normalized[key] = Number(element[key]);
    }
  });
  if (Number.isFinite(Number(element.points))) {
    normalized.points = Math.max(1, Number(element.points));
  }
  if (Array.isArray(element.options)) {
    normalized.options = normalizeStringList(element.options);
  }
  if (Array.isArray(element.interactionTriggers)) {
    normalized.interactionTriggers = element.interactionTriggers
      .filter((trigger) => trigger && typeof trigger === 'object')
      .map((trigger, index) => {
        const normalizedTrigger = {
          id: typeof trigger.id === 'string' && trigger.id.trim() ? trigger.id.trim() : `trigger-${index + 1}`,
          name: typeof trigger.name === 'string' ? trigger.name.trim() : `Acao ${index + 1}`,
          enabled: typeof trigger.enabled === 'boolean' ? trigger.enabled : true,
          actionConfig: normalizeActionConfig(trigger.actionConfig && typeof trigger.actionConfig === 'object' ? trigger.actionConfig : trigger)
        };
        return normalizedTrigger;
      });
  }
  if (Array.isArray(element.videoTriggers)) {
    normalized.videoTriggers = element.videoTriggers
      .filter((trigger) => trigger && typeof trigger === 'object')
      .map((trigger, index) => ({
        id: typeof trigger.id === 'string' && trigger.id.trim() ? trigger.id.trim() : `video-trigger-${index + 1}`,
        name: typeof trigger.name === 'string' ? trigger.name.trim() : `Tempo ${index + 1}`,
        enabled: typeof trigger.enabled === 'boolean' ? trigger.enabled : true,
        time: Number.isFinite(Number(trigger.time ?? trigger.videoTriggerTime)) ? Number(trigger.time ?? trigger.videoTriggerTime) : 0,
        actionConfig: normalizeActionConfig(
          trigger.actionConfig && typeof trigger.actionConfig === 'object'
            ? trigger.actionConfig
            : {
              type: trigger.action || trigger.videoTriggerAction,
              targetElementId: trigger.targetElementId || trigger.videoTriggerTargetElementId,
              videoTime: trigger.seekTime ?? trigger.videoTriggerSeekTime
            }
        )
      }));
  }
  if (element.actionConfig && typeof element.actionConfig === 'object') {
    normalized.actionConfig = normalizeActionConfig(element.actionConfig);
  }
  return normalized;
}

function normalizeActionConfig(config) {
  const normalized = {};
  ['type', 'targetSlideId', 'targetElementId', 'text', 'url', 'quizQuestion', 'ruleGroup', 'textColor', 'backgroundColor', 'textAlign', 'fontFamily', 'fontWeight', 'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor', 'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'replaceMode', 'replaceText', 'detectorAcceptedDrag'].forEach((key) => {
    if (typeof config[key] === 'string') {
      normalized[key] = config[key];
    }
  });
  if (typeof config.generationPrompt === 'string' && config.generationPrompt.trim()) {
    normalized.generationPrompt = config.generationPrompt.trim();
  }
  if (typeof config.requireAllButtonsInGroup === 'boolean') {
    normalized.requireAllButtonsInGroup = config.requireAllButtonsInGroup;
  }
  ['insertX', 'insertY', 'insertWidth', 'insertHeight', 'quizCorrectOption', 'moveByX', 'moveByY', 'moveDuration', 'fontSize', 'points', 'replaceCounterStart', 'replaceCounterStep', 'videoTime', 'detectorMinMatchCount'].forEach((key) => {
    if (Number.isFinite(Number(config[key]))) {
      normalized[key] = Number(config[key]);
    }
  });
  if (typeof config.hasTextBackground === 'boolean') {
    normalized.hasTextBackground = config.hasTextBackground;
  }
  if (typeof config.hasTextBorder === 'boolean') {
    normalized.hasTextBorder = config.hasTextBorder;
  }
  if (typeof config.hasTextBlock === 'boolean') {
    normalized.hasTextBlock = config.hasTextBlock;
  }
  if (typeof config.lockOnWrong === 'boolean') {
    normalized.lockOnWrong = config.lockOnWrong;
  }
  if (typeof config.detectorTriggerOnce === 'boolean') {
    normalized.detectorTriggerOnce = config.detectorTriggerOnce;
  }
  if (typeof config.audioVisible === 'boolean') {
    normalized.audioVisible = config.audioVisible;
  }
  if (typeof config.audioLoop === 'boolean') {
    normalized.audioLoop = config.audioLoop;
  }
  if (typeof config.playSourceVideoOnValidate === 'boolean') {
    normalized.playSourceVideoOnValidate = config.playSourceVideoOnValidate;
  }
  if (Array.isArray(config.quizOptions)) {
    normalized.quizOptions = normalizeStringList(config.quizOptions);
  }
  return normalized;
}

function createSafeId(prefix, value, index = 0) {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${prefix}-${slug || index + 1}`;
}


function requestExplicitlyForbidsNewSlides(request) {
  return /\b(nao|não)\s+(?:crie|gere|adicione|faca|faça|monte)\s+(?:outros?|novos?|mais\s+)?slides?\b|\b(?:somente|apenas|so|só)\s+(?:neste|nesse|este|esse|o)\s+slide\b|\bslide\s+atual\b|\bsem\s+criar\s+(?:outros?|novos?)\s+slides?\b/i.test(
    request || ''
  );
}

function requestSuggestsButtons(request) {
  return /(botao|botão|botoes|botões|acao|ação|interativo|interação|interacao|clicar|clique|naveg)/i.test(
    request || ''
  );
}

function requestExplicitlyAsksForGeneratedImage(request) {
  const normalized = String(request || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized) {
    return false;
  }
  return (
    /\b(gere|crie|faca|desenhe|monte|quero|transforme|renderize)\b[\s\S]{0,80}\b(imagem|ilustracao|foto|desenho|arte|icone|visual|olho|personagem|objeto|cena)\b/.test(normalized) ||
    /\b(imagem|ilustracao|foto|desenho|arte|icone|visual)\b[\s\S]{0,60}\b(ia|gerada|gerar|criar|nova)\b/.test(normalized) ||
    /\b(use|usar)\b[\s\S]{0,40}\b(ia de imagem|gerador de imagem)\b/.test(normalized) ||
    normalized.includes('generationprompt')
  );
}

function requestExplicitlyForbidsNewSlides(request) {
  return /\b(nao|n\u00e3o)\s+(?:crie|gere|adicione|faca|fa\u00e7a|monte)\s+(?:outros?|novos?|mais\s+)?slides?\b|\b(?:somente|apenas|so|s\u00f3)\s+(?:neste|nesse|este|esse|o)\s+slide\b|\bslide\s+atual\b|\bsem\s+criar\s+(?:outros?|novos?)\s+slides?\b/i.test(
    request || ''
  );
}


function requestExplicitlyForbidsNewSlides(request) {
  const normalized = String(request || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    normalized.includes('nao crie outros slides') ||
    normalized.includes('nao crie mais slides') ||
    normalized.includes('nao gere outros slides') ||
    normalized.includes('nao adicione outros slides') ||
    normalized.includes('slide atual') ||
    /\b(apenas|somente|so)\b[\s\S]{0,40}\bslide\b/.test(normalized) ||
    /\bsem\s+criar\s+(outros?|novos?)\s+slides?\b/.test(normalized)
  );
}

function requestSuggestsStoryFlow(request) {
  if (requestExplicitlyForbidsNewSlides(request)) {
    return false;
  }
  return /\b(varios\s+slides?|multiplos\s+slides?|mais\s+de\s+um\s+slide|historia|jornada|aventura|sequencia|passo\s+a\s+passo|capitulo|deck|apresentacao|aula\s+completa)\b/i.test(
    String(request || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );
}

function extractRequestedSlideCount(request) {
  const normalizedRequest = String(request || '').trim().toLowerCase();
  if (!normalizedRequest) {
    return null;
  }
  const directMatch = normalizedRequest.match(/(\d+)\s+slides?/i);
  if (directMatch) {
    const count = Number(directMatch[1]);
    return Number.isFinite(count) && count > 0 ? count : null;
  }
  const numberWords = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    'três': 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10
  };
  const wordMatch = normalizedRequest.match(/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s+slides?\b/i);
  if (!wordMatch) {
    return null;
  }
  return numberWords[wordMatch[1].toLowerCase()] || null;
}

function ensureSlideIds(actions) {
  const usedIds = new Set();
  actions.forEach((action, index) => {
    if (action.type === 'add_slide') {
      const nextId = action.slide?.id || createSafeId('slide', action.slide?.title, index);
      action.slide = {
        ...(action.slide || {}),
        id: usedIds.has(nextId) ? `${nextId}-${index + 1}` : nextId
      };
      usedIds.add(action.slide.id);
    }
  });
  return actions;
}

function inferSlideSequence(actions, existingSlides = []) {
  const sequence = [...existingSlides.map((slide) => slide.id).filter(Boolean)];
  actions.forEach((action) => {
    if (action.type === 'add_slide' && action.slide?.id) {
      if (!sequence.includes(action.slide.id)) {
        if (action.afterSlideId) {
          const afterIndex = sequence.indexOf(action.afterSlideId);
          if (afterIndex >= 0) {
            sequence.splice(afterIndex + 1, 0, action.slide.id);
          } else {
            sequence.push(action.slide.id);
          }
        } else {
          sequence.push(action.slide.id);
        }
      }
    }
  });
  return sequence;
}

function resolveSlideReferenceAliases(actions, existingSlides = []) {
  const aliasMap = new Map();
  const existingIds = existingSlides.map((slide) => slide.id).filter(Boolean);
  existingIds.forEach((id, index) => {
    aliasMap.set(`slide-${index + 1}`, id);
  });

  let runningSlideCount = existingIds.length;
  actions.forEach((action, index) => {
    if (action.type === 'add_slide' && action.slide?.id) {
      runningSlideCount += 1;
      aliasMap.set(`slide-${runningSlideCount}`, action.slide.id);
      aliasMap.set(`novo-slide-${index + 1}`, action.slide.id);
    }
  });

  const resolveRef = (value) => {
    if (!value || typeof value !== 'string') {
      return value;
    }
    return aliasMap.get(value) || value;
  };

  actions.forEach((action) => {
    if (action.slideId) {
      action.slideId = resolveRef(action.slideId);
    }
    if (action.afterSlideId) {
      action.afterSlideId = resolveRef(action.afterSlideId);
    }
    if (action.element?.actionConfig?.targetSlideId) {
      action.element.actionConfig.targetSlideId = resolveRef(action.element.actionConfig.targetSlideId);
    }
  });

  return actions;
}

function inferElementTypeFromId(elementId = '') {
  const value = String(elementId || '').toLowerCase();
  if (value.includes('bloco') || value.includes('block')) return 'block';
  if (value.includes('texto') || value.includes('text') || value.includes('title') || value.includes('titulo') || value.includes('subtitle') || value.includes('subtitulo')) return 'text';
  if (value.includes('botao') || value.includes('botão') || value.includes('button')) return 'floatingButton';
  if (value.includes('quiz')) return 'quiz';
  if (value.includes('imagem') || value.includes('image')) return 'image';
  if (value.includes('camera') || value.includes('webcam') || value.includes('cam')) return 'camera';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  return '';
}

function findTargetSlideByAction(action, existingSlides = []) {
  return existingSlides.find((slide) => slide.id === action.slideId) || null;
}

function resolveElementReferenceAliases(actions, existingSlides = []) {
  const actionElementMap = new Map();
  actions.forEach((action) => {
    if ((action.type === 'add_element' || action.type === 'update_element') && action.slideId) {
      const aliasCandidates = [action.elementId, action.element?.id].filter((value) => typeof value === 'string' && value.trim());
      aliasCandidates.forEach((alias) => {
        actionElementMap.set(`${action.slideId}::${alias.trim()}`, action.element?.id || alias.trim());
      });
    }
  });

  actions.forEach((action) => {
    if (!['update_element', 'delete_element', 'select_element'].includes(action.type)) {
      return;
    }
    if (!action.elementId) {
      return;
    }
    const mappedElementId = actionElementMap.get(`${action.slideId || ''}::${action.elementId}`);
    if (mappedElementId) {
      action.elementId = mappedElementId;
      return;
    }
    const targetSlide = findTargetSlideByAction(action, existingSlides);
    const elements = targetSlide?.elements || [];
    if (!elements.length) {
      return;
    }
    const exact = elements.find((element) => element.id === action.elementId);
    if (exact) {
      return;
    }

    const inferredType = action.element?.type || inferElementTypeFromId(action.elementId);
    const typeMatches = inferredType ? elements.filter((element) => element.type === inferredType) : [];
    if (typeMatches.length === 1) {
      action.elementId = typeMatches[0].id;
      return;
    }
    if (elements.length === 1) {
      action.elementId = elements[0].id;
    }
  });

  return actions;
}

function repairButtonActions(actions, existingSlides = []) {
  const slideSequence = inferSlideSequence(actions, existingSlides);
  actions.forEach((action) => {
    if (action.type !== 'add_element' && action.type !== 'update_element') {
      return;
    }
    if (action.element?.type !== 'floatingButton') {
      return;
    }
    const buttonConfig = action.element.actionConfig || {};
    if (buttonConfig.type && buttonConfig.type !== 'none') {
      return;
    }
    const currentSlideId = action.slideId;
    const currentIndex = slideSequence.indexOf(currentSlideId);
    const nextSlideId = currentIndex >= 0 ? slideSequence[currentIndex + 1] : '';
    const previousSlideId = currentIndex > 0 ? slideSequence[currentIndex - 1] : '';
    const label = String(action.element.label || '').toLowerCase();
    const isBackButton = /(anterior|voltar|retornar|volta|←|back)/i.test(label);
    const prefersJump = Boolean(nextSlideId || previousSlideId);
    action.element.actionConfig = {
      ...buttonConfig,
      type: prefersJump ? 'jumpSlide' : 'addText',
      ...(prefersJump
        ? { targetSlideId: isBackButton ? previousSlideId || nextSlideId : nextSlideId || previousSlideId }
        : {
          text: buttonConfig.text || 'Novo conteudo desbloqueado.',
          insertX: Number.isFinite(Number(buttonConfig.insertX)) ? Number(buttonConfig.insertX) : 720,
          insertY: Number.isFinite(Number(buttonConfig.insertY)) ? Number(buttonConfig.insertY) : 180,
          insertWidth: Number.isFinite(Number(buttonConfig.insertWidth)) ? Number(buttonConfig.insertWidth) : 340,
          insertHeight: Number.isFinite(Number(buttonConfig.insertHeight)) ? Number(buttonConfig.insertHeight) : 120
        })
    };
  });
  return actions;
}

function countNewSlides(actions) {
  return actions.filter((action) => action.type === 'add_slide').length;
}

function countInteractiveButtons(actions) {
  return actions.filter((action) => {
    const config = action.element?.actionConfig;
    return (
      (action.type === 'add_element' || action.type === 'update_element') &&
      action.element?.type === 'floatingButton' &&
      config?.type &&
      config.type !== 'none'
    );
  }).length;
}

function summarizeSlideRecord(slide, index = 0) {
  return {
    order: index + 1,
    id: slide.id,
    title: slide.title,
    backgroundColor: slide.backgroundColor || null,
    backgroundImage: slide.backgroundImage || null,
    elementCount: Array.isArray(slide.elements) ? slide.elements.length : 0,
    elements: Array.isArray(slide.elements)
      ? slide.elements.slice(0, MAX_SUMMARIZED_ELEMENTS_PER_SLIDE).map((element) => ({
        id: element.id,
        type: element.type,
        label: String(element.label || element.content || element.question || '').slice(0, MAX_SUMMARIZED_LABEL_LENGTH),
        x: Number(element.x) || 0,
        y: Number(element.y) || 0,
        width: Number(element.width) || 0,
        height: Number(element.height) || 0
      }))
      : []
  };
}

function summarizeSlides(slides = [], activeSlideId = null) {
  const normalizedSlides = Array.isArray(slides) ? slides : [];
  if (!normalizedSlides.length) {
    return {
      totalSlides: 0,
      includedSlides: 0,
      activeSlideId: activeSlideId || null,
      slides: []
    };
  }

  const activeIndex = normalizedSlides.findIndex((slide) => slide?.id === activeSlideId);
  const selectedIndexes = [];

  if (activeIndex >= 0) {
    selectedIndexes.push(activeIndex);
  }

  for (let index = normalizedSlides.length - 1; index >= 0 && selectedIndexes.length < MAX_SUMMARIZED_SLIDES; index -= 1) {
    if (!selectedIndexes.includes(index)) {
      selectedIndexes.unshift(index);
    }
  }

  if (!selectedIndexes.length) {
    selectedIndexes.push(0);
  }

  const orderedIndexes = selectedIndexes
    .slice(-MAX_SUMMARIZED_SLIDES)
    .sort((left, right) => left - right);

  return {
    totalSlides: normalizedSlides.length,
    includedSlides: orderedIndexes.length,
    activeSlideId: activeSlideId || null,
    slides: orderedIndexes.map((slideIndex) => summarizeSlideRecord(normalizedSlides[slideIndex], slideIndex))
  };
}

function truncateText(value, maxLength) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function prepareMessagesForProvider(messages = []) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.map((message) => ({
      role: message?.role || 'user',
      content: truncateText(message?.content, MAX_PROVIDER_MESSAGE_CHARS)
    }))
    : [];

  const totalChars = normalizedMessages.reduce((sum, message) => sum + String(message.content || '').length, 0);
  if (totalChars <= MAX_PROVIDER_TOTAL_CHARS) {
    return normalizedMessages;
  }

  let overflow = totalChars - MAX_PROVIDER_TOTAL_CHARS;
  for (let index = normalizedMessages.length - 1; index >= 0 && overflow > 0; index -= 1) {
    if (normalizedMessages[index].role === 'system') {
      continue;
    }
    const currentContent = String(normalizedMessages[index].content || '');
    const minimumLength = 1000;
    const removable = Math.max(0, currentContent.length - minimumLength);
    if (!removable) {
      continue;
    }
    const shrinkBy = Math.min(removable, overflow);
    normalizedMessages[index].content = truncateText(currentContent, currentContent.length - shrinkBy);
    overflow -= shrinkBy;
  }

  return normalizedMessages;
}

function isBlankInitialSlide(slides = []) {
  if (slides.length !== 1) {
    return false;
  }
  const [slide] = slides;
  const hasElements = Array.isArray(slide?.elements) && slide.elements.length > 0;
  return !hasElements;
}

function reuseInitialBlankSlide(actions, existingSlides = []) {
  if (!isBlankInitialSlide(existingSlides) || !actions.length) {
    return actions;
  }
  const firstAddSlideIndex = actions.findIndex((action) => action.type === 'add_slide');
  const initialSlideId = existingSlides[0].id;

  if (firstAddSlideIndex === 0) {
    const firstAction = actions[0];
    actions[0] = {
      type: 'update_slide',
      reason: firstAction.reason || 'Reutilizar o primeiro slide existente.',
      slideId: initialSlideId,
      setActive: true,
      slide: {
        ...Object.fromEntries(Object.entries(firstAction.slide || {}).filter(([key]) => key !== 'id'))
      }
    };
    actions.slice(1).forEach((action) => {
      if (action.afterSlideId === firstAction.slide?.id) {
        action.afterSlideId = initialSlideId;
      }
      if (action.slideId === firstAction.slide?.id) {
        action.slideId = initialSlideId;
      }
      if (action.element?.actionConfig?.targetSlideId === firstAction.slide?.id) {
        action.element.actionConfig.targetSlideId = initialSlideId;
      }
    });
    return actions;
  }

  actions.forEach((action) => {
    if (action.type === 'update_slide' && action.slideId && action.slideId !== initialSlideId) {
      action.slideId = initialSlideId;
      action.setActive = action.setActive !== false;
      if (action.slide?.id) {
        delete action.slide.id;
      }
    }
  });

  return actions;
}

function isActionNoOp(action, existingSlides = []) {
  if (!action || typeof action !== 'object') {
    return false;
  }
  const targetSlide = existingSlides.find((slide) => slide.id === action.slideId);
  if (action.type === 'update_slide') {
    if (!targetSlide || !action.slide) {
      return false;
    }
    return Object.entries(action.slide).every(([key, value]) => targetSlide[key] === value);
  }
  if (action.type === 'update_element') {
    const targetElement = targetSlide?.elements?.find((element) => element.id === action.elementId);
    if (!targetElement || !action.element) {
      return false;
    }
    return Object.entries(action.element).every(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return JSON.stringify(targetElement[key] || {}) === JSON.stringify(value);
      }
      if (Array.isArray(value)) {
        return JSON.stringify(targetElement[key] || []) === JSON.stringify(value);
      }
      return targetElement[key] === value;
    });
  }
  if (action.type === 'add_element') {
    if (!targetSlide || !action.element) {
      return false;
    }
    return (targetSlide.elements || []).some((element) => {
      if (element.type !== action.element.type) {
        return false;
      }
      const comparableKeys = ['content', 'label', 'question', 'src', 'x', 'y', 'width', 'height'];
      return comparableKeys.every((key) => {
        if (!(key in action.element)) {
          return true;
        }
        return element[key] === action.element[key];
      });
    });
  }
  return false;
}

function normalizeRecentActionPayload(recentActions = []) {
  if (!Array.isArray(recentActions)) {
    return [];
  }
  return recentActions
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      type: entry.type || '',
      slideId: entry.slideId || '',
      elementId: entry.elementId || '',
      elementType: entry.element?.type || '',
      slideTitle: entry.slide?.title || '',
      label: entry.element?.label || entry.element?.content || entry.element?.question || ''
    }));
}

function actionFingerprint(action) {
  if (!action || typeof action !== 'object') {
    return '';
  }
  return JSON.stringify({
    type: action.type || '',
    slideId: action.slideId || '',
    elementId: action.elementId || '',
    elementType: action.element?.type || '',
    slide: action.slide || null,
    element: action.element || null
  });
}

function isRepeatedRecentAction(action, recentActions = []) {
  const target = actionFingerprint(action);
  if (!target) {
    return false;
  }
  return recentActions.some((entry) => actionFingerprint(entry) === target);
}

function createFallbackStorySlides(existingSlides = []) {
  const baseAfterId = existingSlides.at(-1)?.id || null;
  return DEFAULT_SLIDE_FLOW_TITLES.map((title, index) => ({
    type: 'add_slide',
    reason: `Criar slide ${title.toLowerCase()} para garantir a progressao narrativa.`,
    ...(index > 0
      ? { afterSlideId: createSafeId('slide', DEFAULT_SLIDE_FLOW_TITLES[index - 1], index - 1) }
      : baseAfterId
        ? { afterSlideId: baseAfterId }
        : {}),
    slide: {
      id: createSafeId('slide', title, index),
      title,
      backgroundColor: ['#fdfbff', '#eef6ff', '#fff6ea'][index] || '#fdfbff'
    },
    setActive: index === 0 && !existingSlides.length
  }));
}

function getDefaultRequestedSlideTitle(index) {
  const titles = ['Introducao', 'Funcionalidades', 'Vantagens', 'Produtividade', 'Conclusao', 'Resumo Final'];
  return titles[index] || `Slide ${index + 1}`;
}

function ensureMinimumStorySlides(actions, request, existingSlides = []) {
  if (!requestSuggestsStoryFlow(request)) {
    return actions;
  }
  if (countNewSlides(actions) > 0 || existingSlides.length >= 2) {
    return actions;
  }
  return [...createFallbackStorySlides(existingSlides), ...actions];
}

function ensureRequestedSlideCount(actions, request, existingSlides = []) {
  const requestedCount = extractRequestedSlideCount(request);
  if (!requestedCount || requestedCount <= 1) {
    return actions;
  }
  const planningState = {
    slides: clonePlanningSlides(existingSlides),
    activeSlideId: existingSlides[0]?.id || null
  };
  actions.forEach((action, index) => {
    applyActionToPlanningState(planningState, JSON.parse(JSON.stringify(action)), index);
  });
  if (planningState.slides.length >= requestedCount) {
    return actions;
  }
  const nextActions = [...actions];
  while (planningState.slides.length < requestedCount) {
    const nextIndex = planningState.slides.length;
    const previousSlideId = planningState.slides.at(-1)?.id;
    const slideTitle = getDefaultRequestedSlideTitle(nextIndex);
    const addSlideAction = {
      type: 'add_slide',
      reason: `Criar slide ${nextIndex + 1} para completar a quantidade solicitada pelo usuario.`,
      ...(previousSlideId ? { afterSlideId: previousSlideId } : {}),
      slide: {
        id: createSafeId('slide', slideTitle, nextIndex),
        title: slideTitle,
        backgroundColor: ['#fdfbff', '#eef6ff', '#fff6ea', '#eefbf5', '#f7f3ff'][nextIndex] || '#fdfbff'
      }
    };
    nextActions.push(addSlideAction);
    applyActionToPlanningState(planningState, JSON.parse(JSON.stringify(addSlideAction)), nextIndex);
  }
  return nextActions;
}

function ensureMinimumButtonActions(actions, request, existingSlides = []) {
  if (!requestSuggestsButtons(request) && !requestSuggestsStoryFlow(request)) {
    return actions;
  }
  const repaired = repairButtonActions(actions, existingSlides);
  if (countInteractiveButtons(repaired) > 0) {
    return repaired;
  }
  const slideSequence = inferSlideSequence(repaired, existingSlides);
  const sourceSlideId = slideSequence[0] || existingSlides[0]?.id || createSafeId('slide', 'Introducao', 0);
  const targetSlideId = slideSequence[1] || '';
  repaired.push({
    type: 'add_element',
    slideId: sourceSlideId,
    reason: 'Adicionar botao interativo automaticamente para garantir navegacao.',
    element: {
      type: 'floatingButton',
      label: targetSlideId ? 'Continuar' : 'Explorar',
      x: 940,
      y: 600,
      width: 190,
      height: 60,
      fontSize: 18,
      fontWeight: '700',
      useGradient: true,
      gradientStart: '#5b8cff',
      gradientEnd: '#27d3ec',
      backgroundColor: '#5b8cff',
      solidColor: '#5b8cff',
      actionConfig: targetSlideId
        ? { type: 'jumpSlide', targetSlideId }
        : { type: 'addText', text: 'Novo conteudo liberado.', insertX: 720, insertY: 200, insertWidth: 320, insertHeight: 120 }
    }
  });
  return repaired;
}

function coercePlatformElementStyles(actions) {
  actions.forEach((action) => {
    if (!['add_element', 'update_element'].includes(action.type)) {
      return;
    }
    const element = action.element;
    if (!element || !['block', 'floatingButton'].includes(element.type)) {
      return;
    }
    const preferredStart =
      element.gradientStart || element.gradientEnd || element.solidColor || element.backgroundColor || '';
    const preferredEnd = element.gradientEnd || element.gradientStart || element.solidColor || element.backgroundColor || '';
    if (!preferredStart && !preferredEnd) {
      return;
    }
    element.useGradient = true;
    element.gradientStart = preferredStart || preferredEnd;
    element.gradientEnd = preferredEnd || preferredStart;
    element.backgroundColor = element.gradientStart;
    element.solidColor = element.gradientStart;
  });
  return actions;
}

function normalizeMoveElementDirections(actions, existingSlides = []) {
  actions.forEach((action) => {
    if (!['add_element', 'update_element'].includes(action.type)) {
      return;
    }
    const element = action.element;
    const config = element?.actionConfig;
    if (!element || !config || config.type !== 'moveElement') {
      return;
    }
    const currentSlide = findTargetSlideByAction(action, existingSlides);
    const currentElement = currentSlide?.elements?.find((item) => item?.id === action.elementId);
    const intentText = [
      action.reason,
      element.label,
      element.content,
      currentElement?.label,
      currentElement?.content,
      currentElement?.question,
      config.text,
      config.targetElementId
    ]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ')
      .toLowerCase();

    if (/(esquerda|left)\b/i.test(intentText) && Number.isFinite(Number(config.moveByX))) {
      config.moveByX = -Math.abs(Number(config.moveByX));
    } else if (/(direita|right)\b/i.test(intentText) && Number.isFinite(Number(config.moveByX))) {
      config.moveByX = Math.abs(Number(config.moveByX));
    }

    if (/(cima|subir|suba|up)\b/i.test(intentText) && Number.isFinite(Number(config.moveByY))) {
      config.moveByY = -Math.abs(Number(config.moveByY));
    } else if (/(baixo|descer|desca|down)\b/i.test(intentText) && Number.isFinite(Number(config.moveByY))) {
      config.moveByY = Math.abs(Number(config.moveByY));
    }
  });
  return actions;
}

function normalizePlanItemActions(actions, currentPlanItem, existingSlides = []) {
  if (!currentPlanItem || !Array.isArray(actions) || !actions.length) {
    return actions;
  }
  const normalizedTitle = String(currentPlanItem.title || '').trim().toLowerCase();
  const existingMatch = existingSlides.find(
    (slide) => String(slide?.id || '').trim() === String(currentPlanItem.targetSlideId || '').trim()
      || (normalizedTitle && String(slide?.title || '').trim().toLowerCase() === normalizedTitle)
  );
  let targetSlideId = currentPlanItem.targetSlideId || existingMatch?.id || '';
  let hasTargetSlideCreation = false;
  const isActionTargetingAnotherSlide = (action = {}) => {
    const referencedSlideId = String(action.slideId || '').trim();
    if (!referencedSlideId) {
      return false;
    }
    const allowedIds = new Set(
      [
        targetSlideId,
        currentPlanItem.targetSlideId,
        currentPlanItem.id,
        existingMatch?.id
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    if (!allowedIds.size) {
      return false;
    }
    return !allowedIds.has(referencedSlideId);
  };

  const rewritten = [];
  for (const rawAction of actions) {
    const action = JSON.parse(JSON.stringify(rawAction));
    if (action.type === 'add_slide') {
      const actionTitle = String(action.slide?.title || '').trim().toLowerCase();
      const titleMatches = normalizedTitle && actionTitle === normalizedTitle;
      if (!targetSlideId) {
        targetSlideId = String(action.slide?.id || currentPlanItem.id || createSafeId('slide', currentPlanItem.title, 0)).trim();
      }
      if (titleMatches || !hasTargetSlideCreation) {
        action.slide = {
          ...(action.slide || {}),
          id: targetSlideId,
          title: currentPlanItem.title || action.slide?.title || 'Slide'
        };
        hasTargetSlideCreation = !existingMatch;
        rewritten.push(action);
      }
      continue;
    }
    if (action.type === 'update_slide') {
      if (isActionTargetingAnotherSlide(action)) {
        continue;
      }
      action.slideId = targetSlideId || action.slideId || existingMatch?.id || '';
      if (action.slide) {
        action.slide = {
          ...action.slide,
          title: currentPlanItem.title || action.slide.title
        };
      }
      rewritten.push(action);
      continue;
    }
    if (action.type === 'delete_slide') {
      continue;
    }
    if (isActionTargetingAnotherSlide(action)) {
      continue;
    }
    if (action.slideId || action.type === 'add_element' || action.type === 'update_element' || action.type === 'delete_element' || action.type === 'select_element') {
      action.slideId = targetSlideId || action.slideId || existingMatch?.id || '';
    }
    rewritten.push(action);
  }

  if (!targetSlideId) {
    targetSlideId = String(currentPlanItem.id || createSafeId('slide', currentPlanItem.title, 0)).trim();
  }

  if (!existingMatch && !rewritten.some((action) => action.type === 'add_slide')) {
    rewritten.unshift({
      type: 'add_slide',
      reason: `Criar o slide planejado: ${currentPlanItem.title || 'Slide'}.`,
      slide: {
        id: targetSlideId,
        title: currentPlanItem.title || 'Slide',
        backgroundColor: '#fdfbff'
      },
      setActive: true
    });
  }

  return rewritten.map((action) => {
    if (action.slideId && !action.slideId.trim()) {
      action.slideId = targetSlideId;
    }
    if (action.type === 'select_element' && !action.slideId) {
      action.slideId = targetSlideId;
    }
    return action;
  });
}

function postProcessActions(actions, request, existingSlides = [], options = {}) {
  const disableStoryExpansion = options?.disableStoryExpansion === true || requestExplicitlyForbidsNewSlides(request);
  const currentPlanItem = options?.currentPlanItem || null;
  let nextActions = ensureSlideIds(actions);
  nextActions = reuseInitialBlankSlide(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  if (!disableStoryExpansion) {
    nextActions = ensureMinimumStorySlides(nextActions, request, existingSlides);
  }
  nextActions = ensureSlideIds(nextActions);
  nextActions = reuseInitialBlankSlide(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  if (!disableStoryExpansion) {
    nextActions = ensureRequestedSlideCount(nextActions, request, existingSlides);
  }
  nextActions = ensureSlideIds(nextActions);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  if (!disableStoryExpansion) {
    nextActions = ensureMinimumButtonActions(nextActions, request, existingSlides);
  }
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  nextActions = repairButtonActions(nextActions, existingSlides);
  nextActions = normalizeMoveElementDirections(nextActions, existingSlides);
  nextActions = coercePlatformElementStyles(nextActions);
  if (disableStoryExpansion && currentPlanItem) {
    nextActions = normalizePlanItemActions(nextActions, currentPlanItem, existingSlides);
  }
  return nextActions;
}

function needsRetry(actions, request, existingSlides = [], options = {}) {
  if (options?.disableStoryExpansion === true || requestExplicitlyForbidsNewSlides(request)) {
    return !Array.isArray(actions) || !actions.length;
  }
  const wantsStory = requestSuggestsStoryFlow(request);
  const wantsButtons = requestSuggestsButtons(request) || wantsStory;
  const requestedCount = extractRequestedSlideCount(request);
  if (wantsStory && countNewSlides(actions) === 0 && existingSlides.length < 2) {
    return true;
  }
  if (requestedCount) {
    const planningState = {
      slides: clonePlanningSlides(existingSlides),
      activeSlideId: existingSlides[0]?.id || null
    };
    actions.forEach((action, index) => {
      applyActionToPlanningState(planningState, JSON.parse(JSON.stringify(action)), index);
    });
    if (planningState.slides.length < requestedCount) {
      return true;
    }
  }
  if (wantsButtons && countInteractiveButtons(actions) === 0) {
    return true;
  }
  return false;
}

function extractJsonContent(rawContent) {
  const content = String(rawContent || '').trim();
  if (!content) {
    throw new Error('A IA retornou uma resposta vazia.');
  }
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractBalancedJsonSubstring(rawContent) {
  const content = extractJsonContent(rawContent);
  const startIndex = content.search(/[\[{]/);
  if (startIndex === -1) {
    throw new Error('A IA nao retornou JSON identificavel.');
  }
  const stack = [];
  let inString = false;
  let escaping = false;
  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']') {
      const last = stack[stack.length - 1];
      if ((char === '}' && last === '{') || (char === ']' && last === '[')) {
        stack.pop();
        if (!stack.length) {
          return content.slice(startIndex, index + 1);
        }
      }
    }
  }
  throw new Error('A IA retornou JSON truncado ou incompleto.');
}

function sanitizeJsonCandidate(rawContent) {
  return extractBalancedJsonSubstring(rawContent)
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function summarizePromptPlanContext(executionPlan = null, currentPlanItem = null) {
  if (!executionPlan || typeof executionPlan !== 'object') {
    return null;
  }
  return {
    mode: executionPlan.mode || 'deck',
    summary: truncateText(executionPlan.summary || '', 200),
    currentPlanItem: currentPlanItem
      ? {
        id: currentPlanItem.id || '',
        title: truncateText(currentPlanItem.title || '', 80),
        goal: truncateText(currentPlanItem.goal || '', 180),
        layoutNotes: truncateText(currentPlanItem.layoutNotes || '', 180),
        interactionNotes: truncateText(currentPlanItem.interactionNotes || '', 180),
        order: currentPlanItem.order || null,
        targetSlideId: currentPlanItem.targetSlideId || null
      }
      : null
  };
}

function createAiPrompt({
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = [],
  attachmentInsights = '',
  templateReferences = null,
  executionPlan = null,
  currentPlanItem = null
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  const wantsGeneratedImage = requestExplicitlyAsksForGeneratedImage(request);

  // Regras dinamicas baseadas no contexto (mantivemos sua logica, mas simplificada)
  const dynamicRules = [];
  if (executionPlan?.mode === 'simple') {
    dynamicRules.push('Faca apenas o pedido simples solicitado. Nao crie novos slides.');
  }
  if (wantsGeneratedImage) {
    dynamicRules.push(
      'O pedido exige uma imagem nova gerada por IA.',
      'Sua resposta deve incluir um elemento do tipo image com generationPrompt detalhado, ou backgroundImagePrompt se o pedido for claramente um fundo.',
      'Nao resolva esse pedido apenas com bloco, texto, placeholder ou layout sem imagem gerada.'
    );
  }
  
  // Schema capabilities (o que a IA pode usar)
  const capabilities = createAiCapabilityCatalog();

  // Estrutura do Prompt
  const payload = {
    role: 'slide_builder_agent',
    objective: 'Generate actions to modify slide deck based on user request.',
    constraints: [
        'Output MUST be a valid JSON array of actions.',
        'Strictly follow the action schemas provided.',
        'Respect stage bounds (1280x720).',
        'When userRequest names a specific object or element, that textual request defines the final identity. Use attachmentSummary mainly for position, size, silhouette and orientation, not to rename the object.',
        ...ELEMENT_CONFIGURATION_RULES,
        ...dynamicRules
    ],
    context: {
      currentSlides: orderedSlides,
      activeSlideId: activeSlideId || null,
      userRequest: truncateText(request, MAX_REQUEST_LENGTH),
      attachmentSummary: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      explicitImageRequest: wantsGeneratedImage
    },
    availableActions: capabilities.actionTypes, // Envia lista simples de tipos
    elementSchema: capabilities.elementTypes,   // Envia os campos permitidos
    executionPlan: currentPlanItem ? { currentStep: currentPlanItem } : null
  };

  // Exemplo conciso (Few-shot learning funciona melhor com exemplos pequenos)
  const exampleAction = wantsGeneratedImage
    ? {
      type: 'add_element',
      slideId: activeSlideId || 'slide-atual',
      reason: 'Gerar a imagem especifica pedida pelo usuario.',
      element: {
        type: 'image',
        id: 'img-principal',
        generationPrompt: 'close de um olho de cobra com pupila vertical, textura realista, contraste alto e enquadramento limpo',
        x: 420, y: 140, width: 420, height: 320,
        objectFit: 'cover'
      }
    }
    : {
      type: 'add_element',
      slideId: 'slide-intro',
      reason: 'Exemplo de acao',
      element: {
        type: 'text',
        id: 'txt-titulo',
        content: 'Texto Gerado',
        x: 100, y: 100, width: 300, height: 50,
        fontSize: 24, textColor: '#000000'
      }
    };

  // Monta a string final do prompt
  // Importante: Dizer explicitamente para retornar APENAS o JSON
  return JSON.stringify({
    system: `Voce e um motor de edicao de slides. Sua saida e consumida por uma maquina de estados. Nao explique, nao use markdown. Retorne apenas o JSON.
    Regras: ${BASIC_LAYOUT_RULES.join(' ')} ${ELEMENT_CONFIGURATION_RULES.join(' ')} ${dynamicRules.join(' ')}`.trim(),
    payload: payload,
    exampleOutput: [exampleAction] // Mostra o formato exato esperado
  });
}

function summarizeExecutionPlan(executionPlan = null) {
  if (!executionPlan || typeof executionPlan !== 'object') {
    return null;
  }
  if (executionPlan.mode === 'simple') {
    return {
      mode: 'simple',
      summary: truncateText(executionPlan.summary || '', 240),
      simpleTask: executionPlan.simpleTask
        ? {
          title: truncateText(executionPlan.simpleTask.title || '', 120),
          goal: truncateText(executionPlan.simpleTask.goal || '', 220),
          deliverable: truncateText(executionPlan.simpleTask.deliverable || '', 120)
        }
        : null
    };
  }
  return {
    mode: executionPlan.mode || 'deck',
    summary: truncateText(executionPlan.summary || '', 240),
    slides: Array.isArray(executionPlan.slides)
      ? executionPlan.slides.slice(0, MAX_PLAN_SLIDES).map((item, index) => ({
        id: item?.id || `slide-plan-${index + 1}`,
        title: truncateText(item?.title || `Slide ${index + 1}`, 80),
        goal: truncateText(item?.goal || '', 160)
      }))
      : []
  };
}

function createAiStepPrompt({
  request,
  slides,
  activeSlideId,
  stageSize,
  stepIndex = 0,
  recentActions = [],
  attachments = [],
  attachmentInsights = '',
  templateReferences = null,
  executionPlan = null,
  currentPlanItem = null
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  const contextualInstructions = [];
  const wantsGeneratedImage = requestExplicitlyAsksForGeneratedImage(request);

  if (executionPlan?.mode === 'simple') {
    contextualInstructions.push(
      'O pedido foi classificado como simples. Entregue apenas a parte pedida pelo usuario.',
      'Nao crie aula completa, nao invente varios slides e nao extrapole o escopo.',
      'Se bastar uma unica acao util, responda essa acao e depois done true nas proximas respostas.'
    );
  }

  if (executionPlan?.mode === 'deck' && currentPlanItem) {
    contextualInstructions.push(
      `Voce esta executando apenas o item atual do plano: ${truncateText(currentPlanItem.title || `Slide ${currentPlanItem.order || ''}`, 80)}.`,
      'Trabalhe somente neste slide/etapa atual. Nao comece o proximo slide enquanto este ainda nao estiver pronto.',
      'Responda done true quando o slide atual estiver suficientemente completo para esta etapa do plano, nao quando a aula inteira terminar.',
      'Se o slide atual ainda nao existir, sua primeira acao deve criar ou reutilizar esse slide antes de montar os elementos.',
      'Se voce responder com acao para outro slide, essa acao sera descartada.',
      'Evite alterar slides fora do item atual, exceto quando um botao deste slide precisar apontar para um proximo slide ja planejado.'
    );
  }
  if (templateReferences?.length) {
    contextualInstructions.push(
      'Considere templateReferences como referencias compactas de templates validados da loja.',
      'Se houver currentSlideHint, use esse hint como base do layout e da interacao deste passo.',
      'Prefira adaptar estruturas existentes dos templates em vez de recriar tudo do zero.'
    );
  }
  if (wantsGeneratedImage) {
    contextualInstructions.push(
      'O pedido exige uma imagem nova gerada por IA.',
      'Sua proxima acao deve criar ou atualizar um elemento do tipo image com generationPrompt detalhado, ou usar backgroundImagePrompt se o pedido for explicitamente um fundo.',
      'Nao resolva esse pedido so com bloco, texto, placeholder ou layout sem imagem.'
    );
  }

  return JSON.stringify({
    role: 'slide_builder_stepwise',
    task: truncateText(request, MAX_REQUEST_LENGTH),
    stepIndex,
    instructions: [
      'Responda com um unico objeto JSON.',
      'Se ainda houver trabalho a fazer, retorne {"done": false, "action": {...}, "message": "..."}',
      'Se a tarefa ja estiver suficiente, retorne {"done": true, "message": "..."}',
      'Proponha apenas uma acao por resposta.',
      'A acao deve usar apenas os tipos permitidos.',
      'Nunca retorne uma acao vazia ou incompleta.',
      'add_element exige slideId e element completo.',
      'update_element exige slideId, elementId e element com campos reais para alterar.',
      'update_slide exige slideId e slide com campos reais para alterar.',
      'Nao invente slideId nem elementId que ainda nao existam.',
      'Se for usar um slide novo nesta etapa, primeiro retorne add_slide.',
      'Para text, coloque o texto visivel em content e nao em label.',
      'Para quiz, use options como array de strings simples e correctOption como numero.',
      'Para trocar o fundo, use backgroundColor, backgroundImage ou backgroundImagePrompt no slide.',
      'Se userRequest nomear claramente o objeto final, preserve esse objeto mesmo que attachmentInsights seja ambiguo. Use o anexo principalmente para area, posicao, tamanho, silhueta e orientacao.',
      'Mantenha o layout simples, legivel e dentro do palco 1280x720.',
      'Antes de responder, confira se nenhum elemento ultrapassa o palco ou fica cortado.',
      'Cheque se os elementos nao estao montados um sobre o outro. Reorganize com espaco real entre cards, quizzes, blocos e botoes.',
      'Prefira texto importante com bloco ou card atras quando isso melhorar legibilidade.',
      'Cheque se textos realmente cabem no box escolhido. Se a fonte estiver grande demais para width e height, ajuste antes de responder.',
      'Use contraste forte entre fundo, blocos e texto.',
      'Use paleta harmonica e coerente entre fundo, blocos e botoes.',
      'Use animacoes simples quando fizer sentido: fade-in, slide-left, zoom-in, pulse, float ou none.',
      'Quando o pedido pedir animacao, responda com os campos de animacao ja configurados no proprio elemento. Nao diga apenas que o elemento sera animado.',
      'Quando o pedido pedir que um botao faca algo, configure o actionConfig completo para essa acao. Nao deixe o botao sem comportamento real.',
      'Quando o pedido pedir detector, arraste, encaixe ou colisao, configure o detector de forma funcional, com detectorAcceptedDrag, detectorMinMatchCount ou detectorTriggerOnce quando necessario.',
      'Quando o pedido pedir quiz, responda com o quiz completo e configurado, com mensagens, opcoes, resposta correta e botao interno prontos.',
      'Se o pedido pedir interatividade, prefira floatingButton, quiz ou detector com comportamento funcional.',
      'Nunca crie floatingButton vazio. Se houver botao, ele precisa ter actionConfig util para navegar, revelar conteudo, abrir quiz, mover elemento ou tocar animacao.',
      'Se usar moveElement, lembre: moveByX positivo move para a direita, moveByX negativo move para a esquerda, moveByY positivo move para baixo e moveByY negativo move para cima.',
      'Exemplo obrigatorio de referencia: esquerda = moveByX: -160, direita = moveByX: 160, cima = moveByY: -80, baixo = moveByY: 80.',
      'Nao adicione floatingButton para validar quiz comum, porque o proprio quiz ja possui botao interno.',
      'Se usar detector, lembre que ele e invisivel para o aluno. Adicione um elemento visual de apoio quando a area precisar ser percebida.',
      'Use os recursos da plataforma de forma intencional: block para estrutura, text para conteudo, image para ilustracao, floatingButton para acao, quiz para avaliacao e detector para gatilhos invisiveis.',
      'Quando a imagem ajudar a explicar melhor, prefira incluir image com generationPrompt ou fundo com backgroundImagePrompt.',
      'Se houver imagem anexada, use apenas o resumo dela no contexto como referencia visual do pedido.',
      'Se attachmentInsights mencionar seta, ponta, ponteiro ou direcao, preserve essa orientacao no elemento final e na imagem gerada.',
      ...contextualInstructions
    ],
    allowedActionTypes: Array.from(ALLOWED_ACTIONS),
    allowedElementTypes: Array.from(ALLOWED_ELEMENT_TYPES),
    capabilities: createAiCapabilityCatalog(),
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      recentActions,
      executionPlan: summarizeExecutionPlan(executionPlan),
      currentPlanItem: currentPlanItem || null,
      templateReferences,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  });
  return JSON.stringify({
    role: 'slide_builder_stepwise',
    task: truncateText(request, MAX_REQUEST_LENGTH),
    stepIndex,
    instructions: [
      'Responda com um unico objeto JSON.',
      'Se ainda houver trabalho a fazer, retorne {"done": false, "action": {...}, "message": "..."}',
      'Se a tarefa ja estiver suficiente, retorne {"done": true, "message": "..."}',
      'Proponha apenas uma acao por resposta.',
      'A acao deve usar apenas os tipos permitidos.',
      'Nunca retorne uma acao vazia ou incompleta.',
      'add_element exige slideId e element completo.',
      'update_element exige slideId, elementId e element com campos reais para alterar.',
      'update_slide exige slideId e slide com campos reais para alterar.',
      'Nao invente slideId nem elementId que ainda nao existam.',
      'Se for usar um slide novo nesta etapa, primeiro retorne add_slide.',
      'Para text, coloque o texto visivel em content e nao em label.',
      'Ao criar botoes, configure actionConfig funcional.',
      'Ao criar slides, use ids explicitos quando possivel.',
      'Se houver imagem anexada, use apenas o resumo dela no contexto como referencia visual do pedido.',
      'Se precisar de imagem nova criada por IA, use generationPrompt em image, slide.backgroundImagePrompt ou actionConfig.generationPrompt.',
      'Para ilustrar melhor o conteudo, prefira usar o gerador de imagem quando fizer sentido em vez de deixar o slide so com texto.',
      'Ao decidir cores, preserve contraste forte: texto claro em fundo escuro e texto escuro em fundo claro.',
      'Sempre que houver um bloco visual de conteudo, mantenha o texto dentro dele.',
      'Nao sobreponha quizzes e botoes entre si.',
      'Ao criar quiz, use altura minima de 300px com 3 opcoes, 350px com 4 opcoes e some 50px por opcao extra.',
      'Quando um floatingButton inserir elemento no palco, esse elemento nao pode ficar em cima de botoes nem quizzes. Se precisar, reduza um pouco a fonte e reorganize a area, sempre respeitando o limite do palco.',
      'Voce pode animar text, block, floatingButton e image com animationType, animationDuration, animationDelay e animationLoop.',
      'Os animationType permitidos sao: fade-in, fade-out, slide-left, slide-right, rotate-in, pulse, float, zoom-in, motion-recording e none.',
      'Quando precisar de deslocamento quadro a quadro em image, block ou text, use animationType motion-recording com motionFrames bem definidos.',
      'Interprete motion-recording como o uso repetido do recurso Gravar quadro atual: cada frame representa exatamente uma pose registrada do elemento no palco.',
      'Quando o usuario pedir animacao personalizada, mais criativa, cinematografica ou melhor do que os presets, responda com motion-recording e quadros pensados como capturas sucessivas do botao Gravar quadro atual.',
      'Em addText de floatingButton ou detector, voce pode definir text, textColor, backgroundColor, fontSize, fontFamily, fontWeight, textAlign, hasTextBackground, hasTextBorder e hasTextBlock para o texto inserido nascer pronto.',
      'Em replaceText de floatingButton ou detector, defina targetElementId e use replaceMode replace para trocar o conteudo completo ou replaceMode counter para concatenar prefixo com contador usando replaceText, replaceCounterStart e replaceCounterStep.',
      'Em addQuiz de floatingButton ou detector, voce pode definir quizQuestion, quizOptions, quizCorrectOption, successMessage, errorMessage, actionLabel, quizBackgroundColor, quizQuestionColor, quizOptionBackgroundColor, quizOptionTextColor, quizButtonBackgroundColor, points e lockOnWrong para o quiz nascer completo.',
      'moveByX e moveByY aceitam numeros negativos quando o deslocamento precisar ir para a esquerda ou para cima.',
      'Detector e floatingButton podem usar actionConfig.type moveElement para deslocar image, block ou text ja existente com moveByX e moveByY.',
      'Detector e floatingButton podem usar actionConfig.type playAnimation para disparar a animacao de image, block ou text ja existente com targetElementId.',
      'Use o tipo detector como uma area invisivel de colisao ou encaixe no palco.',
      'Use studentCanDrag true em text, block ou image quando o pedido exigir que o aluno arraste esse elemento.',
      'Em motion-recording, proponha quadros progressivos com pequenos deslocamentos consistentes baseados no palco 1280x720 para o movimento parecer continuo.',
      'Nao proponha motion-recording com apenas quadro inicial e final quando o movimento atravessar boa parte do palco; prefira quadros intermediarios.',
      'Use animationLoop true apenas em pulse ou float quando o efeito continuo fizer sentido. Para entradas como fade-in, slide-left, slide-right, rotate-in e zoom-in, prefira animationLoop false.',
      'Para motion-recording, prefira animationLoop false em narrativas guiadas e true apenas quando o movimento continuo fizer sentido visual.',
      'Se precisar manter destaque continuo, voce pode deixar o elemento animado continuamente com animationLoop true, especialmente em CTA, imagem principal ou card de destaque.',
      'Nao use animationType em quiz, audio ou video.',
      'Voce cuida do layout, da hierarquia visual e da estrategia de composicao.',
      'Voce tem acesso aos slides existentes e aos elementos de cada slide no contexto.',
      'Entenda a ordem dos slides pelo campo order.',
      'Se ja existir um primeiro slide vazio, reutilize esse slide em vez de criar outro primeiro slide.',
      'Quando criar um novo slide e quiser adicionar elementos nele nos proximos passos, use o id real desse slide.',
      'Nunca invente elementId para update_element. So use ids de elementos que existirem no contexto.',
      'Para pedidos simples, como criar um bloco azul simples, tente resolver em uma unica acao add_element ja com cor, tamanho e posicao finais.',
      'Evite fazer add_element e depois varios update_element no mesmo elemento sem necessidade.',
      'Se o pedido ja estiver satisfeito pelo estado atual, responda done true em vez de repetir ajustes.',
      'Nao repita uma acao equivalente a uma acao recente que ja foi aplicada.',
      'Nao use markdown, cercas de codigo ou texto fora do JSON.'
    ],
    allowedActionTypes: Array.from(ALLOWED_ACTIONS),
    allowedElementTypes: Array.from(ALLOWED_ELEMENT_TYPES),
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      recentActions,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  });
}

function createAiExecutionPlanPrompt({
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = [],
  attachmentInsights = '',
  templateReferences = null
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  const requestedSlideCount = extractRequestedSlideCount(request);
  const wantsGeneratedImage = requestExplicitlyAsksForGeneratedImage(request);
  return JSON.stringify({
    role: 'slide_builder_planner',
    task: truncateText(request, MAX_REQUEST_LENGTH),
    instructions: [
      'Responda com um unico objeto JSON valido e sem markdown.',
      'Planeje primeiro e nao retorne acoes nesta etapa.',
      'Se o pedido for simples, isolado ou pontual, retorne {"mode":"simple","summary":"...","simpleTask":{"title":"...","goal":"...","deliverable":"..."}}.',
      'Considere simples quando o usuario quiser apenas um elemento, uma imagem, um bloco, um ajuste pontual, um unico pedaço de conteudo ou algo para completar um slide ja existente.',
      'Nao transforme um pedido simples em aula completa, sequencia de slides ou layout inteiro.',
      'Se o pedido realmente exigir varios slides, retorne {"mode":"deck","summary":"...","slides":[...]} com um item por slide planejado.',
      'Em mode deck, cada item de slides deve ter id, title, goal, layoutNotes e interactionNotes.',
      'Pense como um construtor em etapas: primeiro separe o conteudo por slides e depois a execucao vai montar um slide por vez.',
      'Se o pedido mencionar quantidade de slides, respeite essa quantidade no plano.',
      'Se houver apenas um slide vazio no editor, o primeiro item do plano pode reutilizar esse slide em vez de criar outro.',
      ...(wantsGeneratedImage
        ? [
          'Se o pedido explicitar gerar uma imagem, ilustracao, desenho, foto ou visual especifico, classifique como mode simple sempre que possivel.',
          'Nesse caso, o deliverable deve deixar claro que a execucao precisa criar um elemento image com generationPrompt detalhado para disparar a IA de imagem.',
          'Nao transforme um pedido visual especifico em layout generico sem imagem.'
        ]
        : []),
      'Se o pedido mencionar animacao, detector, quiz, CTA ou configuracao funcional, descreva isso no goal ou deliverable do plano para a execucao nao esquecer de configurar os campos do elemento.',
      'Se attachmentInsights mencionar seta, direcao ou orientacao do rabisco, preserve isso explicitamente no plano do item atual.',
      'Se templateReferences estiver presente, use essas referencias para inspirar a progressao narrativa, a distribuicao de tipos de slide e a complexidade de cada etapa sem copiar o conteudo literal.',
      'Nao inclua campos desnecessarios, comentarios ou texto fora do JSON.'
    ],
    context: {
      requestedSlideCount,
      explicitImageRequest: wantsGeneratedImage,
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      templateReferences,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  });
}

function createAiReviewPrompt({ request, slides, activeSlideId, stageSize, attachments = [], attachmentInsights = '', templateReferences = null }) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  return JSON.stringify({
    role: 'slide_builder_reviewer',
    task: truncateText(request, MAX_REQUEST_LENGTH),
    instructions: [
      'Revise apenas o basico: estrutura, legibilidade, contraste, hierarquia e se as acoes estao aplicaveis.',
      'Cheque se existe acao vazia, slideId inventado, elementId inexistente ou update sem patch real.',
      'Cheque se o layout cabe no palco 1280x720 e se nenhum elemento fica cortado para fora do palco.',
      'Cheque se nao ha elementos montados um sobre o outro sem necessidade, especialmente quizzes, blocos grandes e botoes.',
      'Cheque se o texto esta em content quando o elemento for text.',
      'Cheque se o quiz usa options como lista de strings simples e nao como objetos.',
      'Cheque se o fundo do slide foi configurado nas propriedades do slide quando o pedido era trocar fundo.',
      'Cheque se textos importantes possuem bloco, faixa ou card de apoio quando isso faria a leitura ficar melhor.',
      'Cheque se a paleta de cores esta harmonica e coerente entre fundo, blocos, botoes e texto.',
      'Cheque se a proposta usa bem as ferramentas da plataforma quando o pedido pedir interatividade ou slide elaborado.',
      'Cheque se, quando o pedido mencionar animacao, os campos animationType, animationDuration, animationDelay, animationLoop ou motionFrames foram realmente configurados em vez de apenas sugeridos em texto.',
      'Cheque se todo floatingButton possui actionConfig util e nao ficou apenas decorativo.',
      'Cheque se quiz, detector e botoes vieram realmente configurados para cumprir o pedido, e nao apenas inseridos com valores genericos.',
      'Se o pedido mencionar detector, hotspot, quiz ou botao funcional e a proposta devolver apenas block, image ou text sem o tipo funcional correto, considere isso errado.',
      'Cheque se nao existe botao redundante tentando validar um quiz comum.',
      'Cheque se moveElement usa a direcao correta: moveByX positivo para direita, negativo para esquerda, moveByY positivo para baixo e negativo para cima.',
      'Se a proposta disser para mover para a esquerda e o valor estiver positivo, considere isso errado. Esquerda precisa de valor negativo, como -160.',
      'Cheque se attachmentInsights mencionar seta ou direcao e se essa orientacao foi preservada corretamente.',
      'Cheque se faltou imagem gerada quando uma ilustracao ajudaria claramente a explicar melhor o slide.',
      'Se templateReferences estiver presente, cheque se a composicao final aproveitou bem a estrutura validada sem copiar o texto literal.',
      'Se ainda houver um ajuste importante, retorne um unico objeto JSON no formato {"done": false, "action": {...}, "message": "..."}',
      'Se o resultado estiver bom, retorne {"done": true, "message": "..."}',
      'Proponha no maximo uma acao corretiva.',
      'Nao use markdown nem texto fora do JSON.'
    ],
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      templateReferences,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  });
  return JSON.stringify({
    role: 'slide_builder_reviewer',
    task: truncateText(request, MAX_REQUEST_LENGTH),
    instructions: [
      'Revise o resultado atual e pense se ele esta correto, completo e interativo.',
      'Cheque contraste e legibilidade do texto sobre fundos, blocos e imagens.',
      'Cheque se as animacoes, quando existirem, estao coerentes com o objetivo do slide e se nao estao excessivas.',
      'Cheque se animationLoop true foi usado apenas quando houver motivo visual claro e sem poluir o slide.',
      'Se ainda houver um ajuste importante, retorne um unico objeto JSON no formato {"done": false, "action": {...}, "message": "..."}',
      'Se o resultado estiver bom, retorne {"done": true, "message": "..."}',
      'Proponha no maximo uma acao corretiva.',
      'Nao use markdown nem texto fora do JSON.'
    ],
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  });
}

function clonePlanningSlides(slides = []) {
  return JSON.parse(JSON.stringify(Array.isArray(slides) ? slides : []));
}

function findPlanningSlide(planningState, requestedSlideId) {
  if (!planningState?.slides?.length) {
    return null;
  }
  return (
    planningState.slides.find((slide) => slide.id === requestedSlideId) ||
    planningState.slides.find((slide) => slide.id === planningState.activeSlideId) ||
    planningState.slides[0] ||
    null
  );
}

function findPlanningElement(slide, action = {}) {
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  if (!elements.length) {
    return null;
  }
  const exact = elements.find((element) => element.id === action.elementId);
  if (exact) {
    return exact;
  }
  const inferredType = action.element?.type || inferElementTypeFromId(action.elementId);
  const sameType = inferredType ? elements.filter((element) => element.type === inferredType) : [];
  if (sameType.length === 1) {
    return sameType[0];
  }
  return elements.length === 1 ? elements[0] : null;
}

function applyActionToPlanningState(planningState, action, index = 0) {
  if (!planningState || !action || typeof action !== 'object') {
    return planningState;
  }
  switch (action.type) {
    case 'add_slide': {
      const slide = {
        id: action.slide?.id || createSafeId('slide', action.slide?.title, index),
        title: action.slide?.title || `Slide ${planningState.slides.length + 1}`,
        elements: [],
        backgroundImage: action.slide?.backgroundImage || null,
        backgroundColor: action.slide?.backgroundColor || '#fdfbff'
      };
      const afterIndex = planningState.slides.findIndex((entry) => entry.id === action.afterSlideId);
      if (afterIndex >= 0) {
        planningState.slides.splice(afterIndex + 1, 0, slide);
      } else {
        planningState.slides.push(slide);
      }
      if (action.setActive !== false) {
        planningState.activeSlideId = slide.id;
      }
      break;
    }
    case 'update_slide': {
      let targetSlide = findPlanningSlide(planningState, action.slideId);
      if (!targetSlide && action.slide) {
        targetSlide = {
          id: action.slideId || action.slide.id || createSafeId('slide', action.slide.title, index),
          title: action.slide.title || `Slide ${planningState.slides.length + 1}`,
          elements: [],
          backgroundImage: action.slide.backgroundImage || null,
          backgroundColor: action.slide.backgroundColor || '#fdfbff'
        };
        const afterIndex = planningState.slides.findIndex((entry) => entry.id === action.afterSlideId);
        if (afterIndex >= 0) {
          planningState.slides.splice(afterIndex + 1, 0, targetSlide);
        } else {
          planningState.slides.push(targetSlide);
        }
      }
      if (targetSlide && action.slide) {
        action.slideId = targetSlide.id;
        Object.assign(targetSlide, { ...action.slide, id: targetSlide.id });
        if (action.setActive) {
          planningState.activeSlideId = targetSlide.id;
        }
      }
      break;
    }
    case 'delete_slide': {
      if (planningState.slides.length <= 1) {
        break;
      }
      const targetIndex = planningState.slides.findIndex((entry) => entry.id === action.slideId);
      if (targetIndex >= 0) {
        const [removedSlide] = planningState.slides.splice(targetIndex, 1);
        if (planningState.activeSlideId === removedSlide?.id) {
          planningState.activeSlideId = planningState.slides[targetIndex]?.id || planningState.slides[targetIndex - 1]?.id || planningState.slides[0]?.id || null;
        }
      }
      break;
    }
    case 'add_element': {
      const targetSlide = findPlanningSlide(planningState, action.slideId);
      if (!targetSlide || !action.element?.type) {
        break;
      }
      const nextElement = {
        id: action.element.id || createSafeId('element', action.element.label || action.element.content || action.element.type, index),
        ...action.element
      };
      targetSlide.elements = Array.isArray(targetSlide.elements) ? targetSlide.elements : [];
      targetSlide.elements.push(nextElement);
      action.slideId = targetSlide.id;
      action.elementId = nextElement.id;
      if (action.setActive) {
        planningState.activeSlideId = targetSlide.id;
      }
      break;
    }
    case 'update_element': {
      const targetSlide = findPlanningSlide(planningState, action.slideId);
      const targetElement = findPlanningElement(targetSlide, action);
      if (targetSlide && targetElement && action.element) {
        Object.assign(targetElement, { ...action.element, id: targetElement.id });
        action.slideId = targetSlide.id;
        action.elementId = targetElement.id;
        if (action.setActive) {
          planningState.activeSlideId = targetSlide.id;
        }
      }
      break;
    }
    case 'delete_element': {
      const targetSlide = findPlanningSlide(planningState, action.slideId);
      const targetElement = findPlanningElement(targetSlide, action);
      if (targetSlide && targetElement) {
        targetSlide.elements = targetSlide.elements.filter((entry) => entry.id !== targetElement.id);
      }
      break;
    }
    case 'select_element':
      if (action.slideId) {
        planningState.activeSlideId = action.slideId;
      }
      break;
    default:
      break;
  }
  return planningState;
}

function isRecoverableJsonError(error) {
  const message = String(error?.message || error || '');
  return /json|truncad|incomplet|unterminated|unexpected end|expected ','|expected '}'|nao retornou/i.test(message);
}

function createUserMessageContent(prompt, attachments = []) {
  const normalizedPrompt = String(prompt || '').trim();
  return normalizedPrompt;
}

async function callGoogleGenerateContent({ settings, parts }) {
  const apiKey = decryptApiKey(settings.image_encrypted_api_key || settings.encrypted_api_key);
  const baseUrl = String(settings.image_base_url || settings.base_url || DEFAULT_IMAGE_PROVIDER.baseUrl).replace(/\/+$/, '');
  const model = String(settings.image_model || settings.model || DEFAULT_IMAGE_PROVIDER.model).trim();
  const response = await fetch(`${baseUrl}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts
        }
      ]
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || 'Falha ao chamar o provedor de imagem.');
  }
  return body;
}

function extractGoogleText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts
    .map((part) => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractGoogleImageDataUrl(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  const imagePart = parts.find((part) => part?.inline_data?.data || part?.inlineData?.data);
  const inlineData = imagePart?.inline_data || imagePart?.inlineData;
  if (!inlineData?.data) {
    return '';
  }
  const mimeType = inlineData.mime_type || inlineData.mimeType || 'image/png';
  return `data:${mimeType};base64,${inlineData.data}`;
}

function applyImageFallbacks(actions = []) {
  return actions.map((action, index) => {
    if (action?.slide?.backgroundImagePrompt) {
      action.slide.backgroundColor = action.slide.backgroundColor || '#eef2ff';
      delete action.slide.backgroundImagePrompt;
    }
    if (action?.element?.type === 'image' && action.element.generationPrompt && !action.element.src) {
      action.element = {
        id: action.element.id || createSafeId('element', 'imagem-sugerida', index),
        type: 'block',
        content: `Imagem sugerida: ${action.element.generationPrompt}`,
        x: Number(action.element.x) || 760,
        y: Number(action.element.y) || 150,
        width: Math.max(180, Number(action.element.width) || 320),
        height: Math.max(140, Number(action.element.height) || 220),
        backgroundColor: '#dfe6ff',
        solidColor: '#dfe6ff',
        gradientStart: '#dfe6ff',
        gradientEnd: '#dfe6ff',
        useGradient: true
      };
    }
    if (action?.element?.actionConfig?.type === 'addImage' && action.element.actionConfig.generationPrompt && !action.element.actionConfig.url) {
      action.element.actionConfig.type = 'addText';
      action.element.actionConfig.text = `Imagem sugerida ao clicar: ${action.element.actionConfig.generationPrompt}`;
      delete action.element.actionConfig.generationPrompt;
    }
    return action;
  });
}

async function generateImageWithNanoBanana({ imageSettings, prompt, attachments = [] }) {
  if (!imageSettings?.image_encrypted_api_key || imageSettings.image_is_enabled === false) {
    throw new Error('Configure a Nano Banana no painel admin antes de pedir imagens geradas por IA.');
  }
  const parts = [
    ...attachments.map((attachment) => ({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.data
      }
    })),
    {
      text: String(prompt || '').trim()
    }
  ];
  const body = await callGoogleGenerateContent({
    settings: imageSettings,
    parts
  });
  const dataUrl = extractGoogleImageDataUrl(body);
  if (!dataUrl) {
    const textReply = extractGoogleText(body);
    throw new Error(textReply || 'A Nano Banana nao retornou uma imagem nesta solicitacao.');
  }
  return dataUrl;
}

function extractMaskColor(text = '') {
  const match = String(text || '').match(/MASK_COLOR\s*:\s*(#[0-9a-fA-F]{6})/);
  return match ? match[1].toUpperCase() : '';
}

async function generateBackgroundMaskWithNanoBanana({ imageSettings, attachment }) {
  const normalizedAttachments = normalizeImageAttachments(attachment ? [attachment] : []);
  if (!normalizedAttachments.length) {
    throw new Error('Envie uma imagem valida para gerar a mascara de fundo.');
  }
  if (!imageSettings?.image_encrypted_api_key || imageSettings.image_is_enabled === false) {
    throw new Error('Configure a Nano Banana no painel admin antes de remover o fundo.');
  }
  const parts = [
    ...normalizedAttachments.map((entry) => ({
      inline_data: {
        mime_type: entry.mimeType,
        data: entry.data
      }
    })),
    {
      text: [
        'Analise a imagem e identifique claramente qual e o assunto ou conteudo principal dela.',
        'Considere como objeto principal apenas esse assunto central que da sentido a imagem.',
        'Edite a imagem enviada preservando integralmente o objeto principal em primeiro plano.',
        'Tudo que nao fizer parte desse assunto principal deve ser tratado como fundo.',
        'Recolora tudo que nao pertence ao objeto principal usando uma unica cor solida de mascara.',
        'Inclua nessa mascara o fundo inteiro, sombras, reflexos, halo, contorno externo e qualquer borda residual ao redor do objeto.',
        'Se houver texto, logotipo, produto, pessoa, carro ou qualquer elemento que seja o foco da imagem, preserve isso e transforme o restante em fundo.',
        'Prefira a cor #00FF00.',
        'Se essa cor conflitar com o objeto principal, use #FF00FF.',
        'Nao adicione transparencia.',
        'Nao altere o objeto principal.',
        'O resultado deve ficar pronto para que todo pixel da cor de mascara seja removido automaticamente depois.',
        'Retorne a imagem editada e inclua tambem uma linha de texto exatamente no formato MASK_COLOR: #RRGGBB.'
      ].join(' ')
    }
  ];
  const body = await callGoogleGenerateContent({
    settings: imageSettings,
    parts
  });
  const dataUrl = extractGoogleImageDataUrl(body);
  if (!dataUrl) {
    const textReply = extractGoogleText(body);
    throw new Error(textReply || 'A Nano Banana nao retornou a imagem mascarada.');
  }
  const textReply = extractGoogleText(body);
  return {
    dataUrl,
    maskColor: extractMaskColor(textReply) || '#00FF00',
    textReply
  };
}

function parseNanoBananaJsonReply(text = '') {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('A Nano Banana nao retornou texto para a comparacao.');
  }
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] || raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  try {
    return JSON.parse(jsonText);
  } catch {
    const matchedMatch = raw.match(/\bmatched\b\s*[:=]\s*(true|false|1|0|"true"|"false")/i);
    const confidenceMatch = raw.match(/\bconfidence\b\s*[:=]\s*("?)(0(?:\.\d+)?|1(?:\.0+)?)\1/i);
    const reasonMatch = raw.match(/\breason\b\s*[:=]\s*("?)([^"\n}]+)\1/i);
    if (!matchedMatch) {
      throw new Error('A Nano Banana nao retornou JSON valido para a comparacao.');
    }
    return {
      matched: /true|1/i.test(matchedMatch[1]),
      confidence: confidenceMatch ? Number(confidenceMatch[2]) : 0,
      reason: reasonMatch ? reasonMatch[2].trim() : ''
    };
  }
}

function buildImageFingerprint(attachment) {
  if (!attachment?.data) {
    return '';
  }
  return crypto.createHash('sha256').update(String(attachment.data).trim()).digest('hex');
}

function areImageAttachmentsIdentical(referenceAttachment, submittedAttachment) {
  if (!referenceAttachment?.data || !submittedAttachment?.data) {
    return false;
  }
  return buildImageFingerprint(referenceAttachment) === buildImageFingerprint(submittedAttachment);
}

async function compareImagesWithNanoBanana({ imageSettings, referenceAttachment, submittedAttachment }) {
  const normalizedAttachments = normalizeImageAttachments([referenceAttachment, submittedAttachment]);
  if (normalizedAttachments.length < 2) {
    throw new Error('Envie a imagem de referencia e a imagem do aluno para comparar.');
  }
  if (!imageSettings?.image_encrypted_api_key || imageSettings.image_is_enabled === false) {
    throw new Error('Configure e ative a Nano Banana no painel admin antes de comparar imagens.');
  }
  const [referenceImage, submittedImage] = normalizedAttachments;
  if (areImageAttachmentsIdentical(referenceImage, submittedImage)) {
    return {
      matched: true,
      confidence: 1,
      reason: 'As imagens sao exatamente iguais.',
      rawText: 'LOCAL_EXACT_MATCH'
    };
  }
  const body = await callGoogleGenerateContent({
    settings: imageSettings,
    parts: [
      {
        text: [
          'Voce vai comparar duas imagens para validar uma atividade de aluno.',
          'A primeira imagem e a REFERENCIA definida pelo criador da aula.',
          'A segunda imagem e a RESPOSTA enviada pelo aluno.',
          'Considere matched=true quando a segunda imagem representar o mesmo item, objeto, cena, documento, composicao, estrutura, desenho, diagrama ou conteudo visual principal da referencia, mesmo com diferencas de arquivo, resolucao, corte, compressao, iluminacao, cores, enquadramento, fundo, escala, rotacao leve, perspectiva, anotacoes pequenas ou captura por print/foto.',
          'Considere matched=true quando as duas imagens tiverem o mesmo significado visual para fins pedagogicos, ainda que nao sejam pixel a pixel iguais.',
          'Considere matched=false quando a resposta mostrar outro conteudo principal, outro objeto, outra cena, outro documento, estiver generica demais, ambigua demais ou sem semelhanca suficiente.',
          'Retorne SOMENTE JSON valido no formato {"matched":boolean,"confidence":number,"reason":"texto curto"}.',
          'confidence deve ir de 0 a 1.',
          'reason deve ser curto, objetivo e em portugues.'
        ].join(' ')
      },
      {
        text: 'Imagem 1: referencia.'
      },
      {
        inline_data: {
          mime_type: referenceImage.mimeType,
          data: referenceImage.data
        }
      },
      {
        text: 'Imagem 2: resposta do aluno.'
      },
      {
        inline_data: {
          mime_type: submittedImage.mimeType,
          data: submittedImage.data
        }
      }
    ]
  });
  const textReply = extractGoogleText(body);
  const parsed = parseNanoBananaJsonReply(textReply);
  return {
    matched: Boolean(parsed?.matched),
    confidence: Math.max(0, Math.min(1, Number(parsed?.confidence) || 0)),
    reason: truncateText(String(parsed?.reason || '').trim(), 240),
    rawText: textReply
  };
}

async function describeAttachmentsWithNanoBanana({ imageSettings, attachments = [], request = '' }) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  if (!normalizedAttachments.length || !imageSettings?.image_encrypted_api_key || imageSettings.image_is_enabled === false) {
    return '';
  }
  const isFunctionalRequest = requestTargetsFunctionalPlatformElement(request);
  const isArrowRequest = requestExplicitlyTargetsArrowLikeObject(request);
  const parts = [
    ...normalizedAttachments.map((attachment) => ({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.data
      }
    })),
    {
      text: isFunctionalRequest
        ? `Pedido do usuario: ${truncateText(request, 320)}. Descreva em portugues, de forma curta e objetiva, o rabisco anexado como referencia funcional de area, posicao, tamanho, direcao e intencao espacial. Nao descreva o anexo como arte final pronta e nao transforme automaticamente um retangulo/mancha/traço em bloco visual. Se houver seta, ponteiro, fluxo ou desenho direcional, diga explicitamente para qual lado a ponta aponta e qual e o sentido principal do traco, sem ambiguidade. Se o pedido sugerir detector, hotspot, botao, quiz, area de clique ou encaixe, destaque que o rabisco parece marcar uma zona funcional no palco.`
        : isArrowRequest
          ? `Pedido do usuario: ${truncateText(request, 320)}. Descreva em portugues, de forma curta e objetiva, o que aparece na imagem anexada e quais detalhes visuais importam para criar um slide interativo alinhado ao pedido do usuario. Como o pedido envolve seta, flecha ou direcao, diga explicitamente para qual lado a ponta aponta e qual e o sentido principal do traco, sem ambiguidade.`
          : `Pedido do usuario: ${truncateText(request, 320)}. Descreva em portugues, de forma curta e objetiva, o que aparece na imagem anexada e quais detalhes visuais importam para criar um slide interativo alinhado ao pedido do usuario. O nome do objeto pedido pelo usuario tem prioridade sobre semelhancas visuais ambiguas do rabisco. Nao conclua que o objeto final e uma seta, flecha, xicara ou outro item especifico se isso nao estiver claro no texto do pedido; descreva apenas forma geral, proporcao, posicao e detalhes relevantes.`
    }
  ];
  const body = await callGoogleGenerateContent({
    settings: imageSettings,
    parts
  });
  return extractGoogleText(body);
}

function normalizeMagicPenSourceBounds(sourceBounds = null, stageSize = null) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const x = Math.max(0, Number(sourceBounds?.x) || 0);
  const y = Math.max(0, Number(sourceBounds?.y) || 0);
  const width = Math.max(40, Number(sourceBounds?.width) || 280);
  const height = Math.max(40, Number(sourceBounds?.height) || 180);
  return {
    x: Math.min(x, Math.max(0, safeStage.width - 40)),
    y: Math.min(y, Math.max(0, safeStage.height - 40)),
    width: Math.min(width, safeStage.width),
    height: Math.min(height, safeStage.height)
  };
}

function heuristicClassifyMagicPenRequest(request = '') {
  const normalized = normalizeReferenceText(request);
  const functionalPattern = /(detector|hotspot|area invisivel|gatilho|encaixe|drop|drag|arrast|quiz|pergunta interativa|botao|cta|clicar|click|input|campo|formulario|resposta|enviar|naveg|floatingbutton|nextslide|jumpslide)/i;
  const imagePattern = /(imagem|ilustracao|foto|desenho|arte|icone|icone|visual|personagem|objeto|cena|olho|rosto|animal|textura|logo)/i;
  const hasFunctional = functionalPattern.test(normalized);
  const hasImage = requestExplicitlyAsksForGeneratedImage(normalized) || imagePattern.test(normalized);
  if (hasFunctional && hasImage) {
    return {
      route: 'functional_image',
      reason: 'O pedido mistura comportamento funcional da plataforma com um visual novo gerado por IA.'
    };
  }
  if (hasFunctional) {
    return {
      route: 'functional',
      reason: 'O pedido descreve principalmente um elemento funcional da plataforma.'
    };
  }
  return {
    route: 'image',
    reason: 'O pedido descreve principalmente a criacao de um visual ou imagem.'
  };
}

function createMagicPenClassificationPrompt({ request, attachmentInsights = '' }) {
  return JSON.stringify({
    role: 'magic_pen_router',
    instructions: [
      'Classifique o pedido do pincel magico em exatamente uma rota.',
      'Rotas permitidas: image, functional, functional_image.',
      'image = quando o objetivo principal e gerar um visual, ilustracao, foto, icone, personagem, objeto ou cena.',
      'functional = quando o objetivo principal e criar ou configurar elementos reais da plataforma, como floatingButton, input, detector, quiz, navegacao ou gatilhos.',
      'functional_image = quando o pedido combina elemento funcional real com imagem gerada por IA, por exemplo botao com imagem, hotspot com ilustracao, card funcional com icone/visual novo.',
      'Nao use markdown. Responda somente JSON valido no formato {"route":"image|functional|functional_image","reason":"texto curto em portugues"}.',
      'Se houver duvida entre functional e functional_image, escolha functional_image somente quando a imagem gerada for parte importante do resultado final.'
    ],
    context: {
      userRequest: truncateText(request, 600),
      attachmentSummary: truncateText(attachmentInsights, 500)
    }
  });
}

function parseMagicPenRoutePayload(rawContent) {
  const content = sanitizeJsonCandidate(rawContent);
  const payload = JSON.parse(content);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('A IA do roteador nao retornou um objeto JSON valido.');
  }
  const route = String(payload.route || '').trim();
  if (!MAGIC_PEN_ALLOWED_ROUTES.has(route)) {
    throw new Error('A IA do roteador retornou uma rota invalida.');
  }
  return {
    route,
    reason: truncateText(String(payload.reason || '').trim(), 240)
  };
}

async function parseMagicPenRouteResponse(settingsRow, messages, rawContent) {
  try {
    return parseMagicPenRoutePayload(rawContent);
  } catch (error) {
    const repairedContent = await callCompatibleChatApi({
      settings: settingsRow,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: truncateText(rawContent, MAX_REPAIR_ECHO_CHARS)
        },
        {
          role: 'user',
          content:
            'Sua resposta veio em formato invalido. Reescreva como um unico JSON valido no formato {"route":"image|functional|functional_image","reason":"texto curto"} sem markdown.'
        }
      ],
      temperature: 0
    });
    return parseMagicPenRoutePayload(repairedContent);
  }
}

async function classifyMagicPenRequest({
  settingsRow,
  request,
  attachmentInsights = ''
}) {
  const fallback = heuristicClassifyMagicPenRequest(request);
  try {
    const messages = [
      {
        role: 'system',
        content: settingsRow.system_prompt || DEFAULT_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: createMagicPenClassificationPrompt({
          request,
          attachmentInsights
        })
      }
    ];
    const content = await callCompatibleChatApi({
      settings: settingsRow,
      messages,
      temperature: 0
    });
    const parsed = await parseMagicPenRouteResponse(settingsRow, messages, content);
    return {
      route: parsed.route,
      reason: parsed.reason || fallback.reason
    };
  } catch (error) {
    return fallback;
  }
}

function buildMagicPenImagePrompt({
  request,
  attachmentInsights = '',
  sourceBounds = null,
  stageSize = null
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const bounds = normalizeMagicPenSourceBounds(sourceBounds, safeStage);
  return [
    'Modo pincel magico de imagem.',
    'Use a imagem anexada como rabisco-base do professor.',
    'O objetivo e gerar a arte final pedida pelo texto, respeitando o rabisco como referencia principal de composicao, silhueta, orientacao e proporcao.',
    'Nao trate o rabisco como arte final literal, mas preserve a intencao espacial dele.',
    'Nao ignore o prompt do professor.',
    'Nao adicione textos tipograficos, molduras extras, mockups, interfaces ou elementos fora do pedido.',
    'Se o prompt nomear claramente o objeto final, esse nome tem prioridade sobre semelhancas ambiguas do rabisco.',
    'Se houver seta, ponteiro ou direcao no rabisco, preserve exatamente a orientacao.',
    `Area alvo no palco ${safeStage.width}x${safeStage.height}: x=${Math.round(bounds.x)}, y=${Math.round(bounds.y)}, largura=${Math.round(bounds.width)}, altura=${Math.round(bounds.height)}.`,
    'Gere uma imagem pronta para ser colocada exatamente nessa mesma area do slide, sem depender de recorte manual posterior.',
    attachmentInsights ? `Resumo visual do rabisco: ${attachmentInsights}` : '',
    `Pedido do professor: ${String(request || '').trim()}`
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMagicPenFunctionalRequest({
  request,
  route,
  sourceBounds = null,
  stageSize = null
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const bounds = normalizeMagicPenSourceBounds(sourceBounds, safeStage);
  const wantsGeneratedImage = route === 'functional_image';
  return [
    'Modo pincel magico funcional.',
    'Trabalhe somente no slide atual. Nao crie outros slides.',
    'O rabisco anexado marca a area principal que deve ser usada no resultado final.',
    `Area principal do rabisco no palco ${safeStage.width}x${safeStage.height}: x=${Math.round(bounds.x)}, y=${Math.round(bounds.y)}, largura=${Math.round(bounds.width)}, altura=${Math.round(bounds.height)}.`,
    'O elemento principal deve nascer nessa mesma area ou encaixado estritamente dentro dela, preservando posicao e tamanho com alta fidelidade.',
    'Se o pedido mencionar botao, use exatamente floatingButton e configure actionConfig ou interactionTriggers reais. Nao responda com block colorido fingindo ser botao.',
    'Se o pedido mencionar detector, use exatamente detector. Se mencionar quiz, use exatamente quiz. Se mencionar campo de resposta, use exatamente input.',
    'Quando o pedido pedir comportamento funcional, configure esse comportamento de verdade nos campos da plataforma.',
    wantsGeneratedImage
      ? 'Este pedido tambem exige imagem gerada por IA. Sua resposta deve incluir image com generationPrompt ou actionConfig.type addImage com generationPrompt, em vez de substituir a imagem por block, card ou placeholder.'
      : 'Se o pedido for apenas funcional, nao gere imagem nova a menos que o prompt peça isso explicitamente.',
    wantsGeneratedImage
      ? 'A primeira imagem gerada ligada ao pedido deve usar a mesma area do rabisco como referencia principal de insercao.'
      : '',
    `Pedido do professor: ${String(request || '').trim()}`
  ]
    .filter(Boolean)
    .join('\n');
}

function applyMagicPenBoundsToVisualActions(actions = [], sourceBounds = null, stageSize = null) {
  if (!Array.isArray(actions) || !actions.length || !sourceBounds) {
    return actions;
  }
  const bounds = normalizeMagicPenSourceBounds(sourceBounds, stageSize);
  let visualPlaced = false;
  actions.forEach((action) => {
    if (visualPlaced || !action || typeof action !== 'object') {
      return;
    }
    const element = action.element;
    if (!element || typeof element !== 'object') {
      return;
    }
    if (
      ['add_element', 'update_element'].includes(action.type) &&
      element.type === 'image' &&
      (typeof element.src === 'string' || typeof element.generationPrompt === 'string')
    ) {
      element.x = bounds.x;
      element.y = bounds.y;
      element.width = bounds.width;
      element.height = bounds.height;
      element.objectFit = element.objectFit || 'cover';
      visualPlaced = true;
      return;
    }
    if (
      element.actionConfig &&
      typeof element.actionConfig === 'object' &&
      element.actionConfig.type === 'addImage' &&
      (typeof element.actionConfig.url === 'string' || typeof element.actionConfig.generationPrompt === 'string')
    ) {
      element.actionConfig.insertX = bounds.x;
      element.actionConfig.insertY = bounds.y;
      element.actionConfig.insertWidth = bounds.width;
      element.actionConfig.insertHeight = bounds.height;
      visualPlaced = true;
    }
  });
  return actions;
}

async function proposeMagicPenActions({
  settingsRow,
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = [],
  sourceBounds = null
}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const resolvedStageSize = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const normalizedBounds = normalizeMagicPenSourceBounds(sourceBounds, resolvedStageSize);
  const attachmentInsights = await describeAttachmentsWithNanoBanana({
    imageSettings: settingsRow,
    attachments: normalizedAttachments,
    request
  });
  const classification = await classifyMagicPenRequest({
    settingsRow,
    request,
    attachmentInsights
  });

  if (classification.route === 'image') {
    const src = await generateImageWithNanoBanana({
      imageSettings: settingsRow,
      prompt: buildMagicPenImagePrompt({
        request,
        attachmentInsights,
        sourceBounds: normalizedBounds,
        stageSize: resolvedStageSize
      }),
      attachments: normalizedAttachments
    });
    return {
      mode: 'image',
      classification,
      actions: [
        {
          type: 'add_element',
          slideId: activeSlideId || slides?.[0]?.id || 'slide-atual',
          reason: 'Inserir a imagem gerada pelo pincel magico exatamente na area rabiscada.',
          element: {
            id: createSafeId('element', 'pincel-magico-imagem', 0),
            type: 'image',
            src,
            x: normalizedBounds.x,
            y: normalizedBounds.y,
            width: normalizedBounds.width,
            height: normalizedBounds.height,
            objectFit: 'cover'
          }
        }
      ]
    };
  }

  const routedRequest = buildMagicPenFunctionalRequest({
    request,
    route: classification.route,
    sourceBounds: normalizedBounds,
    stageSize: resolvedStageSize
  });
  const actions = await proposeSlideActionsSafely({
    settingsRow,
    request: routedRequest,
    slides,
    activeSlideId,
    stageSize: resolvedStageSize,
    attachments: normalizedAttachments
  });
  return {
    mode: classification.route,
    classification,
    actions:
      classification.route === 'functional_image'
        ? applyMagicPenBoundsToVisualActions(actions, normalizedBounds, resolvedStageSize)
        : actions
  };
}

async function enrichActionsWithGeneratedImages(actions, settingsRow, attachments = [], context = {}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  if (!settingsRow?.image_encrypted_api_key || settingsRow?.image_is_enabled === false) {
    return applyImageFallbacks(actions);
  }
  const nextActions = Array.isArray(actions) ? actions : [];
  for (const action of nextActions) {
    if (action?.slide?.backgroundImagePrompt) {
      action.slide.backgroundImage = await generateImageWithNanoBanana({
        imageSettings: settingsRow,
        prompt: action.slide.backgroundImagePrompt,
        attachments: normalizedAttachments
      });
      delete action.slide.backgroundImagePrompt;
    }
    if (action?.element?.type === 'image' && action.element.generationPrompt) {
      action.element.src = await generateImageWithNanoBanana({
        imageSettings: settingsRow,
        prompt: action.element.generationPrompt,
        attachments: normalizedAttachments
      });
      delete action.element.generationPrompt;
    }
    if (action?.element?.actionConfig?.type === 'addImage' && action.element.actionConfig.generationPrompt) {
      action.element.actionConfig.url = await generateImageWithNanoBanana({
        imageSettings: settingsRow,
        prompt: action.element.actionConfig.generationPrompt,
        attachments: normalizedAttachments
      });
      delete action.element.actionConfig.generationPrompt;
    }
  }
  return nextActions;
}

async function callCompatibleChatApi({ settings, messages, temperature = 0.2 }) {
  const apiKey = decryptApiKey(settings.encrypted_api_key);
  const baseUrl = String(settings.base_url || '').replace(/\/+$/, '');
  const preparedMessages = prepareMessagesForProvider(messages);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: preparedMessages,
      temperature,
      stream: false
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || 'Falha ao chamar o provedor de IA.');
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('O provedor de IA nao retornou conteudo.');
  }
  return content;
}

async function testAiConnection(settingsRow) {
  const content = await callCompatibleChatApi({
    settings: settingsRow,
    messages: [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: 'Responda apenas com a palavra OK.' }
    ],
    temperature: 0
  });
  const textReply = extractJsonlessText(content);
  let imageReply = '';
  if (settingsRow?.image_encrypted_api_key && settingsRow?.image_is_enabled !== false) {
    const body = await callGoogleGenerateContent({
      settings: settingsRow,
      parts: [{ text: 'Reply only with OK.' }]
    });
    imageReply = extractGoogleText(body) || (extractGoogleImageDataUrl(body) ? 'IMAGE_OK' : '');
  }
  return imageReply ? `Texto: ${textReply} | Nano Banana: ${imageReply}` : textReply;
}

function extractJsonlessText(content) {
  return String(content || '').replace(/```/g, '').trim();
}

function tryParseJsonCandidate(rawContent) {
  const candidate = sanitizeJsonCandidate(rawContent);
  return JSON.parse(candidate);
}

function extractJsonArraySubstring(rawContent) {
  const content = sanitizeJsonCandidate(rawContent);
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('A IA nao retornou um array JSON completo.');
  }
  return content.slice(start, end + 1);
}

async function parseActionsFromModelContent(settingsRow, messages, rawContent) {
  try {
    return tryParseJsonCandidate(rawContent);
  } catch (error) {
    try {
      return JSON.parse(extractJsonArraySubstring(rawContent));
    } catch (nestedError) {
      const repairedContent = await callCompatibleChatApi({
        settings: settingsRow,
        messages: [
          ...messages,
          {
            role: 'assistant',
            content: truncateText(rawContent, MAX_REPAIR_ECHO_CHARS)
          },
          {
            role: 'user',
            content:
              'A resposta anterior veio com JSON invalido ou truncado. Reescreva do zero como um unico array JSON valido, completo e sem markdown. Nao use comentarios. Nao use texto antes ou depois do JSON. Verifique virgulas, aspas e chaves antes de responder.'
          }
        ],
        temperature: 0
      });
      return tryParseJsonCandidate(repairedContent);
    }
  }
}

function parseStepPayload(rawContent) {
  const content = sanitizeJsonCandidate(rawContent);
  const payload = JSON.parse(content);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('A IA nao retornou um objeto JSON valido para o modo incremental.');
  }
  return payload;
}

async function parseStepResponse(settingsRow, messages, rawContent) {
  try {
    return parseStepPayload(rawContent);
  } catch (error) {
    const repairedContent = await callCompatibleChatApi({
      settings: settingsRow,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: truncateText(rawContent, MAX_REPAIR_ECHO_CHARS)
        },
        {
          role: 'user',
          content:
            'Sua resposta veio em formato invalido. Reescreva como um unico objeto JSON valido no formato {"done":false,"action":{...},"message":"..."} ou {"done":true,"message":"..."} sem markdown. Nao use texto antes ou depois do JSON. Verifique virgulas, aspas e chaves antes de responder.'
        }
      ],
      temperature: 0
    });
    return parseStepPayload(repairedContent);
  }
}

function parsePlanPayload(rawContent) {
  const content = sanitizeJsonCandidate(rawContent);
  const payload = JSON.parse(content);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('A IA nao retornou um objeto JSON valido para o planejamento.');
  }
  return payload;
}

async function parsePlanResponse(settingsRow, messages, rawContent) {
  try {
    return parsePlanPayload(rawContent);
  } catch (error) {
    const repairedContent = await callCompatibleChatApi({
      settings: settingsRow,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: truncateText(rawContent, MAX_REPAIR_ECHO_CHARS)
        },
        {
          role: 'user',
          content:
            'Sua resposta veio em formato invalido. Reescreva como um unico objeto JSON valido no formato {"mode":"simple",...} ou {"mode":"deck",...} sem markdown. Nao use texto antes ou depois do JSON.'
        }
      ],
      temperature: 0
    });
    return parsePlanPayload(repairedContent);
  }
}

function normalizeExecutionPlan(planPayload, request, existingSlides = [], activeSlideId = null) {
  const requestedSlideCount = extractRequestedSlideCount(request);
  const normalizedSummary = truncateText(planPayload?.summary || request || '', 280);
  const initialTargetSlideId = activeSlideId || existingSlides[0]?.id || null;
  const shouldPreferSimple =
    requestExplicitlyForbidsNewSlides(request) ||
    !requestedSlideCount &&
    !requestSuggestsStoryFlow(request) &&
    String(planPayload?.mode || '').trim().toLowerCase() !== 'deck';

  if (shouldPreferSimple) {
    const simpleTask = planPayload?.simpleTask && typeof planPayload.simpleTask === 'object' ? planPayload.simpleTask : {};
    return {
      mode: 'simple',
      summary: normalizedSummary,
      simpleTask: {
        id: 'simple-task',
        title: truncateText(simpleTask.title || 'Pedido simples', 80),
        goal: truncateText(simpleTask.goal || request || 'Entregar somente o que foi pedido.', 220),
        deliverable: truncateText(simpleTask.deliverable || 'single_change', 80),
        targetSlideId: typeof simpleTask.targetSlideId === 'string' && simpleTask.targetSlideId.trim()
          ? simpleTask.targetSlideId.trim()
          : initialTargetSlideId
      }
    };
  }

  const rawSlides = Array.isArray(planPayload?.slides) ? planPayload.slides : [];
  const fallbackCount = requestedSlideCount || Math.max(1, Math.min(MAX_PLAN_SLIDES, rawSlides.length || 1));
  const normalizedSlides = rawSlides
    .slice(0, requestedSlideCount || MAX_PLAN_SLIDES)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const title = truncateText(entry.title || getDefaultRequestedSlideTitle(index), 80) || `Slide ${index + 1}`;
      return {
        id: String(entry.id || createSafeId('slide', title, index)).trim() || createSafeId('slide', title, index),
        title,
        goal: truncateText(entry.goal || entry.objective || request || `Desenvolver o slide ${index + 1}.`, 220),
        layoutNotes: truncateText(entry.layoutNotes || entry.layout || '', 220),
        interactionNotes: truncateText(entry.interactionNotes || entry.interaction || '', 220),
        order: index + 1,
        targetSlideId:
          typeof entry.targetSlideId === 'string' && entry.targetSlideId.trim()
            ? entry.targetSlideId.trim()
            : index === 0 && isBlankInitialSlide(existingSlides)
              ? initialTargetSlideId
              : null
      };
    });

  while (normalizedSlides.length < fallbackCount) {
    const index = normalizedSlides.length;
    const title = getDefaultRequestedSlideTitle(index);
    normalizedSlides.push({
      id: createSafeId('slide', title, index),
      title,
      goal: `Desenvolver o slide ${index + 1} com base no pedido do usuario.`,
      layoutNotes: '',
      interactionNotes: '',
      order: index + 1,
      targetSlideId: index === 0 && isBlankInitialSlide(existingSlides) ? initialTargetSlideId : null
    });
  }

  return {
    mode: 'deck',
    summary: normalizedSummary,
    slides: normalizedSlides.slice(0, MAX_PLAN_SLIDES)
  };
}

async function proposeSlideExecutionPlan({
  settingsRow,
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = []
}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const attachmentInsights = await describeAttachmentsWithNanoBanana({
    imageSettings: settingsRow,
    attachments: normalizedAttachments,
    request
  });
  const templateReferences = await buildTemplateReferenceContext({ request });
  const baseMessages = [
    {
      role: 'system',
      content: settingsRow.system_prompt || DEFAULT_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: createUserMessageContent(
        createAiExecutionPlanPrompt({
          request,
          slides,
          activeSlideId,
          stageSize,
          attachments: normalizedAttachments,
          attachmentInsights,
          templateReferences
        })
      )
    }
  ];
  const rawContent = await callCompatibleChatApi({
    settings: settingsRow,
    messages: baseMessages
  });
  const parsed = await parsePlanResponse(settingsRow, baseMessages, rawContent);
  return normalizeExecutionPlan(parsed, request, slides, activeSlideId);
}

async function collectStepwiseActions({
  settingsRow,
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = [],
  attachmentInsights = '',
  executionPlan = null,
  currentPlanItem = null,
  templateReferences = null
}) {
  const planningState = {
    slides: clonePlanningSlides(slides),
    activeSlideId: activeSlideId || slides?.[0]?.id || null
  };
  const collectedActions = [];

  for (let stepIndex = 0; stepIndex < MAX_STEPWISE_ACTIONS; stepIndex += 1) {
    const stepResult = await proposeNextSlideAction({
      settingsRow,
      request,
      slides: planningState.slides,
      activeSlideId: planningState.activeSlideId,
      stageSize,
      stepIndex,
      recentActions: collectedActions.slice(-8),
      attachments,
      attachmentInsights,
      executionPlan,
      currentPlanItem,
      templateReferences
    });

    if (stepResult.done) {
      break;
    }

    if (!stepResult.action) {
      throw new Error('A IA nao retornou uma acao valida durante o fallback incremental.');
    }

    const nextAction = JSON.parse(JSON.stringify(stepResult.action));
    collectedActions.push(nextAction);
    applyActionToPlanningState(planningState, nextAction, stepIndex);
  }

  const reviewResult = await proposeNextSlideAction({
    settingsRow,
    request,
    slides: planningState.slides,
    activeSlideId: planningState.activeSlideId,
    stageSize,
    stepIndex: collectedActions.length,
    reviewMode: true,
    recentActions: collectedActions.slice(-8),
    attachments,
    attachmentInsights,
    templateReferences
  });

  if (!reviewResult.done && reviewResult.action) {
    collectedActions.push(JSON.parse(JSON.stringify(reviewResult.action)));
  }

  return collectedActions;
}

async function proposeSlideActions({
  settingsRow,
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = [],
  executionPlan = null,
  currentPlanItem = null
}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const disableStoryExpansion = Boolean(executionPlan?.mode === 'deck' && currentPlanItem);
  const attachmentInsights = await describeAttachmentsWithNanoBanana({
    imageSettings: settingsRow,
    attachments: normalizedAttachments,
    request
  });
  const templateReferences = await buildTemplateReferenceContext({
    request,
    executionPlan,
    currentPlanItem
  });
  const baseMessages = [
    {
      role: 'system',
      content: settingsRow.system_prompt || DEFAULT_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: createUserMessageContent(
        createAiPrompt({
          request,
          slides,
          activeSlideId,
          stageSize,
          attachments: normalizedAttachments,
          attachmentInsights,
          templateReferences,
          executionPlan,
          currentPlanItem
        })
      )
    }
  ];

  const firstContent = await callCompatibleChatApi({
    settings: settingsRow,
    messages: baseMessages
  });
  const firstParsed = await parseActionsFromModelContent(settingsRow, baseMessages, firstContent);
  let actions = postProcessActions(normalizeActionList(firstParsed), request, slides, {
    disableStoryExpansion,
    currentPlanItem
  });

  if (needsRetry(actions, request, slides, { disableStoryExpansion })) {
    const retryContent = await callCompatibleChatApi({
      settings: settingsRow,
      messages: [
        ...baseMessages,
        {
          role: 'assistant',
          content: JSON.stringify(actions)
        },
        {
          role: 'user',
          content:
            'Sua resposta anterior nao atendeu completamente. Refaça em JSON valido, garantindo novos slides quando houver historia/jornada e garantindo floatingButton com actionConfig funcional quando houver navegacao, escolhas ou interatividade.'
        }
      ]
    });
    const retryParsed = await parseActionsFromModelContent(settingsRow, baseMessages, retryContent);
    actions = postProcessActions(normalizeActionList(retryParsed), request, slides, {
      disableStoryExpansion,
      currentPlanItem
    });
  }

  return enrichActionsWithGeneratedImages(actions, settingsRow, normalizedAttachments, {
    slides,
    activeSlideId,
    stageSize
  });
}

async function proposeSlideActionsSafely(args) {
  try {
    return await proposeSlideActions(args);
  } catch (error) {
    if (!isRecoverableJsonError(error)) {
      throw error;
    }
    const normalizedAttachments = normalizeImageAttachments(args?.attachments);
    const attachmentInsights = await describeAttachmentsWithNanoBanana({
      imageSettings: args?.settingsRow,
      attachments: normalizedAttachments,
      request: args?.request || ''
    });
    const fallbackActions = await collectStepwiseActions({
      settingsRow: args?.settingsRow,
      request: args?.request,
      slides: Array.isArray(args?.slides) ? args.slides : [],
      activeSlideId: args?.activeSlideId || null,
      stageSize: args?.stageSize || null,
      attachments: normalizedAttachments,
      attachmentInsights,
      executionPlan: args?.executionPlan || null,
      currentPlanItem: args?.currentPlanItem || null,
      templateReferences: await buildTemplateReferenceContext({
        request: args?.request,
        executionPlan: args?.executionPlan || null,
        currentPlanItem: args?.currentPlanItem || null
      })
    });
    if (!fallbackActions.length) {
      throw error;
    }
    return fallbackActions;
  }
}

async function proposeNextSlideAction({
  settingsRow,
  request,
  slides,
  activeSlideId,
  stageSize,
  stepIndex = 0,
  reviewMode = false,
  recentActions = [],
  attachments = [],
  attachmentInsights = '',
  templateReferences = null,
  executionPlan = null,
  currentPlanItem = null
}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const resolvedAttachmentInsights =
    typeof attachmentInsights === 'string' && attachmentInsights.trim()
      ? attachmentInsights.trim()
      : await describeAttachmentsWithNanoBanana({
        imageSettings: settingsRow,
        attachments: normalizedAttachments,
        request
      });
  const resolvedTemplateReferences =
    Array.isArray(templateReferences) && templateReferences.length
      ? templateReferences
      : await buildTemplateReferenceContext({
        request,
        executionPlan,
        currentPlanItem
      });
  const normalizedRecentActions = normalizeRecentActionPayload(recentActions);
  const baseMessages = [
    {
      role: 'system',
      content: settingsRow.system_prompt || DEFAULT_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: createUserMessageContent(
        reviewMode
          ? createAiReviewPrompt({
            request,
            slides,
            activeSlideId,
            stageSize,
            attachments: normalizedAttachments,
            attachmentInsights: resolvedAttachmentInsights,
            templateReferences: resolvedTemplateReferences
          })
          : createAiStepPrompt({
            request,
            slides,
            activeSlideId,
            stageSize,
            stepIndex,
            recentActions: normalizedRecentActions,
            attachments: normalizedAttachments,
            attachmentInsights: resolvedAttachmentInsights,
            templateReferences: resolvedTemplateReferences,
            executionPlan,
            currentPlanItem
          })
      )
    }
  ];

  const content = await callCompatibleChatApi({
    settings: settingsRow,
    messages: baseMessages
  });

  const payload = await parseStepResponse(settingsRow, baseMessages, content);
  if (payload.done) {
    return {
      done: true,
      message: typeof payload.message === 'string' ? payload.message : 'Fluxo concluido.'
    };
  }
  if (!payload.action || typeof payload.action !== 'object') {
    throw new Error('A IA nao retornou uma acao valida no modo incremental.');
  }
  const normalizedAction = normalizeSingleAction(payload.action, 0);
  let processed = postProcessActions([normalizedAction], request, slides);
  if (isActionNoOp(processed[0], slides) || isRepeatedRecentAction(processed[0], recentActions)) {
    const retryContent = await callCompatibleChatApi({
      settings: settingsRow,
      messages: [
        ...baseMessages,
        {
          role: 'assistant',
          content: JSON.stringify({
            done: false,
            message: payload.message || '',
            action: payload.action
          })
        },
        {
          role: 'user',
          content:
            'A acao anterior nao muda nada no estado atual ou repete um passo ja feito. Gere uma proxima acao diferente, concreta e util. Se o pedido simples ja foi atendido, responda done true.'
        }
      ]
    });
    const retryPayload = await parseStepResponse(settingsRow, baseMessages, retryContent);
    if (retryPayload.done) {
      return {
        done: true,
        message: typeof retryPayload.message === 'string' ? retryPayload.message : 'Fluxo concluido.'
      };
    }
    if (!retryPayload.action || typeof retryPayload.action !== 'object') {
      throw new Error('A IA repetiu uma resposta invalida no modo incremental.');
    }
    processed = postProcessActions([normalizeSingleAction(retryPayload.action, 0)], request, slides);
    if (isActionNoOp(processed[0], slides) || isRepeatedRecentAction(processed[0], recentActions)) {
      return {
        done: true,
        message: 'A ultima sugestao nao traria mudanca real ou repetiria um passo recente. Encerrando para evitar loop.'
      };
    }
    return {
      done: false,
      message: typeof retryPayload.message === 'string' ? retryPayload.message : 'Acao gerada.',
      action: (
        await enrichActionsWithGeneratedImages(processed, settingsRow, normalizedAttachments, {
          slides,
          activeSlideId,
          stageSize
        })
      )[0]
    };
  }
  return {
    done: false,
    message: typeof payload.message === 'string' ? payload.message : 'Acao gerada.',
    action:
      (
        await enrichActionsWithGeneratedImages(processed, settingsRow, normalizedAttachments, {
          slides,
          activeSlideId,
          stageSize
        })
      )[0] || normalizedAction
  };
}

module.exports = {
  buildPublicAiSettings,
  normalizeActionList,
  proposeMagicPenActions,
  proposeNextSlideAction,
  proposeSlideExecutionPlan,
  proposeSlideActions: proposeSlideActionsSafely,
  generateBackgroundMaskWithNanoBanana,
  compareImagesWithNanoBanana,
  testAiConnection,
  __test: {
    extractJsonContent,
    extractBalancedJsonSubstring,
    sanitizeJsonCandidate,
    tryParseJsonCandidate,
    extractJsonArraySubstring,
    parsePlanPayload,
    parseStepPayload,
    summarizeSlides,
    truncateText,
    applyActionToPlanningState,
    isRecoverableJsonError,
    requestSuggestsStoryFlow,
    requestExplicitlyForbidsNewSlides,
    postProcessActions,
    extractMaskColor,
    parseNanoBananaJsonReply,
    areImageAttachmentsIdentical
  }
};
