const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { decryptApiKey } = require('./aiConfigCrypto');
const { safeFetch } = require('./security');

const allowHttpProviderUrls = !['production', 'prod'].includes(String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase());

const DEFAULT_SYSTEM_PROMPT =
  'Voce e um assistente especializado em montar slides interativos. Responda somente JSON valido.';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';
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
  'key',
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
const MAX_PLAN_SLIDES = 30;
const MAX_PROVIDER_MESSAGE_CHARS = 40000;
const MAX_PROVIDER_TOTAL_CHARS = 120000;
const MAX_REPAIR_ECHO_CHARS = 12000;
const MAX_TEMPLATE_REFERENCES = 2;
const MAX_TEMPLATE_SLIDES_PER_REFERENCE = 16;
const TEMPLATE_STORE_DIR = path.resolve(__dirname, '../../template-store');
const TEMPLATE_REFERENCE_CACHE_TTL_MS = 30000;
const LAYOUT_SAFE_MARGIN = 32;
const LAYOUT_ELEMENT_GAP = 28;
const DEFAULT_DECK_VISUAL_THEMES = [
  {
    key: 'archive-history',
    label: 'Historico editorial',
    keywords: ['historia', 'historico', 'escravidao', 'colonial', 'brasil', 'africa', 'tempo'],
    palette: {
      background: '#f8f1e7',
      backgroundAlt: '#efe3d0',
      surface: '#fffaf0',
      surfaceAlt: '#eadcc4',
      primary: '#7c2d12',
      secondary: '#1f2937',
      accent: '#d97706',
      text: '#1f2937',
      mutedText: '#57534e',
      success: '#15803d',
      danger: '#b91c1c'
    }
  },
  {
    key: 'game-mission',
    label: 'Missao gamificada',
    keywords: ['game', 'jogo', 'gamificado', 'gamificacao', 'arrastar', 'arraste', 'drag', 'drop', 'encaixe', 'colar', 'missao', 'fase', 'pontos'],
    palette: {
      background: '#eef6ff',
      backgroundAlt: '#e8fff6',
      surface: '#ffffff',
      surfaceAlt: '#dbeafe',
      primary: '#2563eb',
      secondary: '#0f766e',
      accent: '#f59e0b',
      text: '#111827',
      mutedText: '#475569',
      success: '#16a34a',
      danger: '#dc2626'
    }
  },
  {
    key: 'science-clear',
    label: 'Ciencia clara',
    keywords: ['ciencia', 'biologia', 'quimica', 'fisica', 'matematica', 'experimento', 'formula'],
    palette: {
      background: '#f0fdfa',
      backgroundAlt: '#ecfeff',
      surface: '#ffffff',
      surfaceAlt: '#ccfbf1',
      primary: '#0f766e',
      secondary: '#1d4ed8',
      accent: '#ea580c',
      text: '#102a43',
      mutedText: '#475569',
      success: '#15803d',
      danger: '#be123c'
    }
  },
  {
    key: 'creative-class',
    label: 'Criativo educacional',
    keywords: ['criativo', 'aula', 'slides', 'apresentacao', 'infantil', 'atividade'],
    palette: {
      background: '#f7f3ff',
      backgroundAlt: '#eff6ff',
      surface: '#ffffff',
      surfaceAlt: '#ede9fe',
      primary: '#6d5dfc',
      secondary: '#0891b2',
      accent: '#f97316',
      text: '#171934',
      mutedText: '#4b5563',
      success: '#16a34a',
      danger: '#e11d48'
    }
  }
];
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
const BASIC_LAYOUT_RULES = [
  'Responda apenas com JSON valido.',
  'O palco tem 1280x720px. Limite rigido: x entre 0 e 1280, y entre 0 e 720.',
  `Margem segura obrigatoria: no minimo ${LAYOUT_SAFE_MARGIN}px de cada borda.`,
  `Espaco minimo entre elementos principais: ${LAYOUT_ELEMENT_GAP}px.`,
  'Calcule a area de cada elemento (x, y, width, height) antes de posicionar outro elemento.',
  'Nao coloque texto por baixo de bloco, imagem, quiz, botao ou outro texto. Se usar card decorativo atras do texto, o texto precisa ficar dentro do card e com zIndex maior.',
  'Use uma paleta unica por deck: fundo, cards, botoes e textos precisam conversar entre si.',
  'Todo slide de deck precisa ter backgroundColor ou backgroundFillType com gradiente coerente.',
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
  'Quando o pedido mencionar slide gamificado, missao, fase, arrastar ou colar, crie uma interacao real usando studentCanDrag true, detector funcional, quiz ou timedTrigger. Nao entregue apenas texto dizendo o que o aluno faria.',
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

function normalizeProviderModel(providerKey = '', baseUrl = '', model = '') {
  const requestedModel = String(model || '').trim();
  const normalizedProvider = normalizeReferenceText(`${providerKey} ${baseUrl}`);
  if (normalizedProvider.includes('deepseek') && (!requestedModel || requestedModel === 'deepseek-chat')) {
    return DEFAULT_DEEPSEEK_MODEL;
  }
  return requestedModel || DEFAULT_DEEPSEEK_MODEL;
}

function getEffectiveChatModel(settings = {}) {
  return normalizeProviderModel(settings.provider_key, settings.base_url, settings.model);
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
  const palette = Array.from(
    new Set(
      [
        slide.backgroundColor,
        slide.backgroundGradientStart,
        slide.backgroundGradientEnd,
        ...elements.flatMap((element) => [
          element?.backgroundColor,
          element?.solidColor,
          element?.gradientStart,
          element?.gradientEnd,
          element?.textColor
        ])
      ].filter((value) => typeof value === 'string' && value.trim())
    )
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
    palette,
    highlights: elements
      .slice(0, 6)
      .map((element) => ({
        type: element?.type || '',
        label: truncateText(
          element?.content || element?.label || element?.question || element?.id || element?.type || '',
          44
        ),
        x: Number(element?.x) || 0,
        y: Number(element?.y) || 0,
        width: Number(element?.width) || 0,
        height: Number(element?.height) || 0,
        fontSize: Number(element?.fontSize) || null,
        actionType: element?.actionConfig?.type || null,
        draggable: element?.studentCanDrag === true
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
        description: truncateText(String(templateSource?.description || '').trim(), 240),
        category: String(payload?.store?.category || '').trim() || 'Geral',
        summary: truncateText(String(payload?.store?.summary || templateSource?.description || '').trim(), 180),
        slideCount: slides.length,
        capabilityTags,
        structureSignature: summarizedSlides.map((slide) => slide.archetype).join(' -> '),
        slides: summarizedSlides,
        rawSlides: slides.slice(0, MAX_TEMPLATE_SLIDES_PER_REFERENCE),
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
  const normalizedRequest = normalizeReferenceText(request);
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
  if (/(gamific|game|jogo|runner|fase|pontos|missao|desafio)/i.test(normalizedRequest) && entry.capabilityTags.includes('drag-drop')) score += 14;
  if (/(gamific|game|jogo|runner|fase|pontos|missao|desafio)/i.test(normalizedRequest) && /(runner|game|jogo|fase)/i.test(`${entry.key} ${entry.title} ${entry.category} ${entry.summary}`)) score += 30;
  if (/(aula|treinamento|curso|interativ|passo a passo|como usar|ensinar|aprenda|iniciante)/i.test(normalizedRequest) && entry.capabilityTags.includes('quiz')) score += 10;
  if (/(planilha|sheets|google sheets|excel)/i.test(normalizedRequest) && /sheets|planilha/i.test(entry.key + ' ' + entry.title)) score += 18;
  if (/(windows|explorer|bloco de notas|informatica|computador)/i.test(normalizedRequest) && /windows|explorer|notas|informatica/i.test(entry.key + ' ' + entry.title)) score += 18;
  if (/quiz/i.test(request) && entry.capabilityTags.includes('quiz')) score += 6;
  if (/(arrast|drag|encaix|detector)/i.test(normalizedRequest) && entry.capabilityTags.includes('drag-drop')) score += 7;
  if (/(video|youtube)/i.test(normalizedRequest) && entry.capabilityTags.includes('video')) score += 5;
  if (/(audio|som|narra)/i.test(normalizedRequest) && entry.capabilityTags.includes('audio')) score += 4;
  if (/(boto|button|cta|navega)/i.test(normalizedRequest) && entry.capabilityTags.includes('buttons')) score += 4;
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

function requestSuggestsEducationalDeck(request = '') {
  if (requestExplicitlyForbidsNewSlides(request)) {
    return false;
  }
  const normalized = normalizeReferenceText(request);
  return /\b(como usar|como fazer|como funciona|ensinar|aprenda|aula|curso|treinamento|passo a passo|guia|tutorial|explicar|sobre)\b/.test(normalized);
}

function createAiCapabilityCatalog() {
  return {
    stage: DEFAULT_STAGE_SIZE,
    slideFields: ['id', 'title', 'backgroundColor', 'backgroundFillType', 'backgroundGradientStart', 'backgroundGradientEnd', 'backgroundImage', 'backgroundImagePrompt'],
    actionTypes: Array.from(ALLOWED_ACTIONS),
    animationTypes: TEMPLATE_ANIMATION_TYPES,
    triggerActionTypes: TEMPLATE_TRIGGER_ACTION_TYPES,
    detectorAcceptedDragExamples: ['any', 'type:image', 'type:text', 'element:element-id'],
    runtimeCapabilities: {
      actionTriggerElements: ['floatingButton', 'detector', 'timedTrigger', 'input', 'key'],
      draggableElementTypes: ['text', 'block', 'image'],
      insertActions: ['addText', 'addImage', 'addAudio', 'addVideo', 'addQuiz'],
      targetActions: ['replaceText', 'showElement', 'hideElement', 'moveElement', 'playAnimation', 'playAudio', 'playVideo', 'pauseVideo', 'seekVideo'],
      navigationActions: ['nextSlide', 'jumpSlide', 'redirect'],
      mediaActions: ['playAudio', 'playVideo', 'pauseVideo', 'seekVideo', 'addAudio', 'addVideo'],
      revealPattern: 'Elemento alvo com initiallyHidden true + trigger showElement apontando para targetElementId.',
      dragDropPattern: 'Peca text/block/image com studentCanDrag true + detector sobre area de destino + detectorAcceptedDrag element:id-da-peca.',
      timedPattern: 'timedTrigger invisivel/pequeno com interactionTriggers[0].time em segundos + actionConfig showElement/addText/moveElement.',
      keyboardPattern: 'key com interactionTriggers[0].keys e actionConfig; use visibleKey true quando o aluno precisa ver a tecla.',
      videoPattern: 'video com videoTriggers por time para adicionar quiz/texto, pausar, buscar tempo, mostrar elemento ou navegar.'
    },
    slideDesignPatterns: [
      'Hero educacional: fundo com gradiente, titulo forte, imagem gerada grande, 2 cards de apoio e botao de continuar.',
      'Mapa conceitual: blocos conectados por posicoes alinhadas, cores da paleta, animacoes fade-in em sequencia.',
      'Arrastar e colar: instrucao curta, peca arrastavel, alvo visual, detector invisivel, feedback ao acertar.',
      'Quiz interativo: pergunta clara, 3-4 opcoes, feedback, pontos, card explicativo ao lado.',
      'Revelar pista: conteudo inicialmenteHidden, botao/key/timedTrigger com showElement, animacao no alvo.',
      'Video com parada: video + videoTriggers para pausar, mostrar pergunta ou adicionar quiz no tempo certo.'
    ],
    usagePlaybook: {
      text: 'Use text para conteudo visivel. Configure content, x, y, width, height, fontSize, textColor, textAlign e estilos de fundo/borda quando o prompt pedir destaque ou card textual.',
      block: 'Use block para estrutura visual, cards, faixas, caixas de destaque e textos em containers. Configure shape, backgroundColor ou gradiente, textColor e dimensoes reais.',
      image: 'Use image com generationPrompt quando o pedido exigir ilustracao, objeto, personagem, icone, seta desenhada, foto ou visual especifico. Defina x, y, width e height coerentes com o palco.',
      camera: 'Use camera quando o pedido precisar transmitir webcam no proprio palco antes de capturar uma foto ou gravar um video. Defina x, y, width e height reais.',
      floatingButton: 'Use floatingButton quando houver CTA, clique, navegacao ou acao manual. Nunca substitua botao por block colorido. Configure interactionTriggers/actionConfig completo, com type funcional e todos os campos exigidos para essa acao.',
      detector: 'Use detector como area invisivel de encaixe/colisao/validacao. Combine com elemento visual de apoio e, em interacoes de arrastar, configure detectorAcceptedDrag e studentCanDrag no item arrastavel.',
      input: 'Use input para resposta digitada, envio de texto, anexo de imagem/audio ou validacao de resposta do aluno. Configure placeholder, submitLabel, compareText/compareImage, mensagens e interactionTriggers.',
      timedTrigger: 'Use timedTrigger quando a interacao depender de tempo automatico. Configure interactionTriggers com time e actionConfig reais.',
      key: 'Use key para controles por teclado em atividades gamificadas. Configure interactionTriggers[0].keys, visibleKey quando fizer sentido e actionConfig real para revelar, mover, animar ou navegar.',
      quiz: 'Use quiz quando o usuario pedir pergunta ou avaliacao pronta no slide. Preencha question, options, correctOption, mensagens, actionLabel, points, lockOnWrong e cores do quiz.',
      animation: 'Quando o prompt pedir animacao, escolha animationType intencional e complemente com animationDuration, animationDelay, animationLoop ou motionFrames. Nao deixe animacao subentendida.'
    },
    configurationRecipes: [
      'Botao para navegar: floatingButton + interactionTriggers/actionConfig.type nextSlide ou jumpSlide + targetSlideId.',
      'Botao para inserir quiz: floatingButton + actionConfig.type addQuiz + quizQuestion + quizOptions + quizCorrectOption + mensagens + cores.',
      'Botao para gerar imagem ao clicar: floatingButton + actionConfig.type addImage + generationPrompt + insertX + insertY + insertWidth + insertHeight.',
      'Campo de resposta: input + placeholder + submitLabel + compareText ou compareImageReference + successMessage + errorMessage + interactionTriggers.',
      'Elemento arrastavel com encaixe: image/text/block com studentCanDrag true + detector com actionConfig funcional e detectorAcceptedDrag apropriado.',
      'Arrastar e colar: crie uma peca visual com studentCanDrag true, uma area visual de destino e um detector invisivel exatamente sobre a area de destino.',
      'Detector de acerto: detector + interactionTriggers[actionConfig.type addText/showElement/playAnimation] + detectorAcceptedDrag element:id-da-peca + detectorMinMatchCount 1 + detectorTriggerOnce true.',
      'Gatilho por tempo: timedTrigger + interactionTriggers com time em segundos + actionConfig completo para mostrar, esconder, mover, animar ou inserir conteudo.',
      'Animacao personalizada: image/text/block/floatingButton com animationType motion-recording e motionFrames progressivos.',
      'Mover elemento: floatingButton ou detector com actionConfig.type moveElement + targetElementId + moveByX/moveByY.',
      'Disparar animacao existente: floatingButton ou detector com actionConfig.type playAnimation + targetElementId.',
      'Revelar conteudo: crie o elemento alvo com initiallyHidden true e um floatingButton/detector/timedTrigger/key com actionConfig.type showElement + targetElementId.',
      'Tecla como controle: key + interactionTriggers com keys ["space"] ou ["arrowright"] + actionConfig real para navegar, mover ou revelar.',
      'Video interativo: video + videoTriggers com time em segundos + actionConfig addText/addQuiz/showElement/seekVideo.'
    ],
    elementTypes: {
      text: ['content', 'x', 'y', 'width', 'height', 'fontSize', 'fontFamily', 'fontWeight', 'textColor', 'textAlign', 'backgroundColor', 'hasTextBackground', 'hasTextBorder', 'hasTextBlock', 'studentCanDrag', 'initiallyHidden', 'opacity', 'animationType', 'animationDuration', 'animationDelay', 'animationLoop', 'motionFrames'],
      block: ['content', 'x', 'y', 'width', 'height', 'shape', 'backgroundColor', 'solidColor', 'useGradient', 'gradientStart', 'gradientEnd', 'textColor', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign', 'textureImage', 'textureFit', 'studentCanDrag', 'initiallyHidden', 'opacity', 'animationType', 'motionFrames'],
      image: ['src', 'generationPrompt', 'x', 'y', 'width', 'height', 'objectFit', 'studentCanDrag', 'initiallyHidden', 'opacity', 'animationType', 'motionFrames'],
      audio: ['src', 'x', 'y', 'width', 'height', 'audioVisible', 'audioLoop', 'collectStudentAudio', 'opacity'],
      video: ['src', 'provider', 'embedSrc', 'x', 'y', 'width', 'height', 'opacity', 'videoTriggers'],
      camera: ['x', 'y', 'width', 'height', 'opacity'],
      quiz: ['question', 'options', 'correctOption', 'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor', 'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'points', 'lockOnWrong', 'x', 'y', 'width', 'height'],
      floatingButton: ['label', 'x', 'y', 'width', 'height', 'shape', 'backgroundColor', 'solidColor', 'useGradient', 'gradientStart', 'gradientEnd', 'textColor', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign', 'opacity', 'animationType', 'actionConfig', 'interactionTriggers'],
      key: ['label', 'content', 'x', 'y', 'width', 'height', 'shape', 'backgroundColor', 'solidColor', 'useGradient', 'gradientStart', 'gradientEnd', 'textColor', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign', 'opacity', 'actionConfig', 'interactionTriggers'],
      detector: ['x', 'y', 'width', 'height', 'actionConfig', 'interactionTriggers'],
      input: ['x', 'y', 'width', 'height', 'placeholder', 'submitLabel', 'compareText', 'compareCaseSensitive', 'compareImageEnabled', 'compareImageReference', 'allowImage', 'allowAudio', 'successMessage', 'errorMessage', 'backgroundColor', 'labelColor', 'inputTextColor', 'submitButtonColor', 'submitButtonTextColor', 'actionConfig', 'interactionTriggers'],
      timedTrigger: ['x', 'y', 'width', 'height', 'actionConfig', 'interactionTriggers']
    },
    triggerSchemas: {
      interactionTrigger: ['id', 'name', 'enabled', 'time', 'keys', 'visibleKey', 'actionConfig'],
      videoTrigger: ['id', 'name', 'enabled', 'time', 'actionConfig'],
      actionConfig: ['type', 'targetSlideId', 'targetElementId', 'text', 'url', 'generationPrompt', 'insertX', 'insertY', 'insertWidth', 'insertHeight', 'moveByX', 'moveByY', 'moveDuration', 'videoTime', 'replaceMode', 'replaceText', 'replaceCounterStart', 'replaceCounterStep', 'quizQuestion', 'quizOptions', 'quizCorrectOption', 'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor', 'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'points', 'lockOnWrong', 'audioVisible', 'audioLoop', 'collectStudentAudio', 'playSourceVideoOnValidate', 'detectorAcceptedDrag', 'detectorMinMatchCount', 'detectorTriggerOnce', 'requireAllButtonsInGroup', 'ruleGroup', 'textColor', 'backgroundColor', 'textAlign', 'fontFamily', 'fontWeight', 'fontSize', 'hasTextBackground', 'hasTextBorder', 'hasTextBlock']
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
      model: DEFAULT_DEEPSEEK_MODEL,
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
      payload.aiTextCreditCostPerCall = 0.5;
      payload.aiImageCreditCostPerCall = 1.0;
    }
    return payload;
  }
  const payload = {
    connected: true,
    providerKey: row.provider_key,
    providerLabel: row.provider_label,
    baseUrl: row.base_url,
    model: getEffectiveChatModel(row),
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
    const textCost = Number.isFinite(Number(row.ai_credit_cost_per_call))
      ? Math.max(0.01, Number(row.ai_credit_cost_per_call))
      : 0.5;
    const imageCost = Number.isFinite(Number(row.image_ai_credit_cost_per_call))
      ? Math.max(0.01, Number(row.image_ai_credit_cost_per_call))
      : 1.0;
    payload.aiCreditCostPerCall = textCost;
    payload.aiTextCreditCostPerCall = textCost;
    payload.aiImageCreditCostPerCall = imageCost;
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
      const estimatedBytes = Buffer.byteLength(data, 'base64');
      if (!mimeType.startsWith('image/') || !data || !/^[a-z0-9+/=\s]+$/i.test(data) || estimatedBytes > 15 * 1024 * 1024) {
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
  [
    'id',
    'title',
    'backgroundImage',
    'backgroundColor',
    'backgroundImagePrompt',
    'backgroundFillType',
    'backgroundGradientStart',
    'backgroundGradientEnd'
  ].forEach((key) => {
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
    'animationLoop', 'initiallyHidden', 'motionFrames', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'fontSize',
    'correctOption', 'animationDuration', 'animationDelay', 'points', 'options', 'actionConfig',
    'textAlign', 'opacity', 'objectFit', 'textureImage', 'textureFit', 'audioVisible', 'audioLoop', 'collectStudentAudio',
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
  if (typeof slide.backgroundFillType === 'string' && slide.backgroundFillType.trim()) {
    normalized.backgroundFillType = slide.backgroundFillType.trim();
  }
  if (typeof slide.backgroundGradientStart === 'string' && slide.backgroundGradientStart.trim()) {
    normalized.backgroundGradientStart = slide.backgroundGradientStart.trim();
  }
  if (typeof slide.backgroundGradientEnd === 'string' && slide.backgroundGradientEnd.trim()) {
    normalized.backgroundGradientEnd = slide.backgroundGradientEnd.trim();
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
  if (typeof element.collectStudentAudio === 'boolean') normalized.collectStudentAudio = element.collectStudentAudio;
  if (typeof element.hasTextBackground === 'boolean') normalized.hasTextBackground = element.hasTextBackground;
  if (typeof element.hasTextBorder === 'boolean') normalized.hasTextBorder = element.hasTextBorder;
  if (typeof element.hasTextBlock === 'boolean') normalized.hasTextBlock = element.hasTextBlock;
  if (typeof element.studentCanDrag === 'boolean') normalized.studentCanDrag = element.studentCanDrag;
  if (typeof element.initiallyHidden === 'boolean') normalized.initiallyHidden = element.initiallyHidden;
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
          time: Number.isFinite(Number(trigger.time ?? trigger.triggerTime))
            ? Math.max(0, Number(trigger.time ?? trigger.triggerTime))
            : 0,
          keys: normalizeStringList(
            Array.isArray(trigger.keys)
              ? trigger.keys
              : Array.isArray(trigger.keyBindings)
                ? trigger.keyBindings
                : typeof trigger.key === 'string'
                  ? [trigger.key]
                  : []
          ),
          visibleKey: typeof trigger.visibleKey === 'boolean' ? trigger.visibleKey : Boolean(trigger.showKey ?? trigger.keyVisible),
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
  if (typeof config.collectStudentAudio === 'boolean') {
    normalized.collectStudentAudio = config.collectStudentAudio;
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
  const normalized = normalizeReferenceText(request);
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

function requestSuggestsButtons(request) {
  return /(botao|botão|botoes|botões|acao|ação|interativo|interação|interacao|clicar|clique|naveg)/i.test(
    request || ''
  );
}

function requestExplicitlyAsksForGeneratedImage(request) {
  const normalized = normalizeReferenceText(request);
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

function inferRequestedImagePolicy(request) {
  const normalized = normalizeReferenceText(request);
  if (/\b(sem|nenhuma?s?)\s+(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/.test(normalized)
    || /\bsem\s+(gerar|criar|usar|colocar|adicionar|inserir)\s+(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/.test(normalized)
    || /\bnao\s+(use|coloque|adicione|gere|crie)\b[\s\S]{0,50}\b(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/.test(normalized)) {
    return 'none';
  }
  if (/\b(muita?s?|varias|bastante?s?)\s+(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/.test(normalized)
    || /\b(imagem|foto|ilustracao)\b[\s\S]{0,30}\b(cada|todo?s?)\s+slides?\b/.test(normalized)) {
    return 'rich';
  }
  if (/\b(pouca?s?|alguma?s?|uma|duas|1|2)\s+(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/.test(normalized)
    || /\bno\s+maximo\b[\s\S]{0,25}\b(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/.test(normalized)) {
    return 'sparse';
  }
  if (/\b(com|inclua|use|usar|adicione|coloque|tenha)\b[\s\S]{0,40}\b(imagens|fotos|ilustracoes)\b/.test(normalized)
    || /\b(imagens|fotos|ilustracoes)\b[\s\S]{0,40}\b(no|nos|em)\s+slides?\b/.test(normalized)) {
    return 'rich';
  }
  return requestExplicitlyAsksForGeneratedImage(request) ? 'required' : 'balanced';
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
}

function cloneVisualTheme(theme = DEFAULT_DECK_VISUAL_THEMES.at(-1)) {
  return {
    key: theme.key,
    label: theme.label,
    palette: { ...(theme.palette || {}) }
  };
}

function getThemeColor(theme, key, fallback) {
  const value = theme?.palette?.[key];
  return isHexColor(value) ? value : fallback;
}

function inferDeckVisualTheme(request, planPayload = null) {
  const modelPalette = planPayload?.visualTheme?.palette || planPayload?.theme?.palette || planPayload?.palette;
  if (modelPalette && typeof modelPalette === 'object') {
    const merged = {
      ...DEFAULT_DECK_VISUAL_THEMES.at(-1).palette,
      ...Object.fromEntries(
        Object.entries(modelPalette)
          .filter(([, value]) => isHexColor(value))
          .map(([key, value]) => [key, String(value).trim()])
      )
    };
    if (Object.values(merged).filter(isHexColor).length >= 6) {
      return {
        key: String(planPayload?.visualTheme?.key || planPayload?.theme?.key || 'custom').trim() || 'custom',
        label: String(planPayload?.visualTheme?.label || planPayload?.theme?.label || 'Paleta personalizada').trim(),
        palette: merged
      };
    }
  }

  const normalized = normalizeReferenceText(request);
  const ranked = DEFAULT_DECK_VISUAL_THEMES
    .map((theme, index) => ({
      theme,
      index,
      score: (theme.keywords || []).reduce((sum, keyword) => sum + (normalized.includes(keyword) ? keyword.length : 0), 0)
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index);
  const selected = ranked[0]?.score > 0 ? ranked[0].theme : DEFAULT_DECK_VISUAL_THEMES.at(-1);
  return cloneVisualTheme(selected);
}

function getThemeSlideStyle(theme, index = 0) {
  const background = getThemeColor(theme, index % 2 === 0 ? 'background' : 'backgroundAlt', '#f7f3ff');
  const alternate = getThemeColor(theme, index % 3 === 2 ? 'surfaceAlt' : 'backgroundAlt', '#eff6ff');
  return {
    backgroundFillType: 'gradient',
    backgroundColor: background,
    backgroundGradientStart: background,
    backgroundGradientEnd: alternate
  };
}

function summarizeVisualThemeForPrompt(theme = null) {
  if (!theme?.palette) {
    return null;
  }
  return {
    key: theme.key || 'custom',
    label: theme.label || 'Paleta do deck',
    palette: {
      background: getThemeColor(theme, 'background', '#f7f3ff'),
      backgroundAlt: getThemeColor(theme, 'backgroundAlt', '#eff6ff'),
      surface: getThemeColor(theme, 'surface', '#ffffff'),
      surfaceAlt: getThemeColor(theme, 'surfaceAlt', '#ede9fe'),
      primary: getThemeColor(theme, 'primary', '#6d5dfc'),
      secondary: getThemeColor(theme, 'secondary', '#0891b2'),
      accent: getThemeColor(theme, 'accent', '#f97316'),
      text: getThemeColor(theme, 'text', '#171934'),
      mutedText: getThemeColor(theme, 'mutedText', '#4b5563'),
      success: getThemeColor(theme, 'success', '#16a34a'),
      danger: getThemeColor(theme, 'danger', '#e11d48')
    }
  };
}

function requestSuggestsGamifiedSlides(request) {
  const normalized = normalizeReferenceText(request);
  return /(gamific|game|jogo|missao|fase|pontos|pontuacao|arrast|drag|drop|encaix|colar|detector|desafio)/i.test(normalized);
}

function inferPlanItemInteractionType(entry = {}, request = '', index = 0, totalSlides = 1) {
  const itemText = normalizeReferenceText([
    entry.interactionType,
    entry.interactionNotes,
    entry.goal,
    entry.title
  ].join(' '));
  const requestText = normalizeReferenceText(request);
  const explicitlyAllDragDrop =
    /\b(todo?s?|cada)\s+slides?\b[\s\S]{0,80}\b(arrast|drag|drop|encaix|colar|detector)\b/i.test(requestText) ||
    /\b(arrast|drag|drop|encaix|colar|detector)\b[\s\S]{0,80}\b(todo?s?|cada)\s+slides?\b/i.test(requestText);
  if (/(arrast|drag|drop|encaix|colar|detector)/i.test(itemText) || explicitlyAllDragDrop) {
    return 'drag-drop';
  }
  if (/(quiz|pergunta|avaliacao|teste)/i.test(itemText)) {
    return 'quiz';
  }
  if (/(tempo|cronometro|timer)/i.test(itemText)) {
    return 'timed-challenge';
  }
  if (requestSuggestsGamifiedSlides(request) && totalSlides > 2) {
    if (index % 4 === 1) return 'drag-drop';
    if (index % 4 === 2) return 'quiz';
    if (index % 4 === 3) return 'timed-challenge';
  }
  return requestSuggestsGamifiedSlides(request) ? 'mission-content' : 'content';
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

function allocateUniqueId(usedIds, prefix, value, index = 0) {
  const baseId = createSafeId(prefix, value, index);
  let candidate = baseId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function ensureSlideIds(actions, existingSlides = []) {
  const usedIds = new Set(existingSlides.map((slide) => slide?.id).filter(Boolean));
  const aliasMap = new Map();
  actions.forEach((action, index) => {
    if (action.slideId && aliasMap.has(action.slideId)) {
      action.slideId = aliasMap.get(action.slideId);
    }
    if (action.afterSlideId && aliasMap.has(action.afterSlideId)) {
      action.afterSlideId = aliasMap.get(action.afterSlideId);
    }
    if (action.type === 'add_slide') {
      const requestedId = action.slide?.id || createSafeId('slide', action.slide?.title, index);
      const nextId = allocateUniqueId(usedIds, 'slide', requestedId.replace(/^slide-/, ''), index);
      action.slide = {
        ...(action.slide || {}),
        id: nextId
      };
      if (requestedId !== nextId) {
        aliasMap.set(requestedId, nextId);
      }
    }
    const configs = [
      action.element?.actionConfig,
      ...(Array.isArray(action.element?.interactionTriggers)
        ? action.element.interactionTriggers.map((trigger) => trigger?.actionConfig)
        : []),
      ...(Array.isArray(action.element?.videoTriggers)
        ? action.element.videoTriggers.map((trigger) => trigger?.actionConfig)
        : [])
    ];
    configs.forEach((config) => {
      if (config?.targetSlideId && aliasMap.has(config.targetSlideId)) {
        config.targetSlideId = aliasMap.get(config.targetSlideId);
      }
    });
  });
  return actions;
}

function ensureElementIds(actions, existingSlides = []) {
  const usedIds = new Set(
    existingSlides.flatMap((slide) => (slide?.elements || []).map((element) => element?.id)).filter(Boolean)
  );
  const aliases = new Map();
  const resolveAlias = (slideId, elementId) =>
    aliases.get(`${slideId || ''}::${elementId || ''}`) || aliases.get(`*::${elementId || ''}`) || elementId;

  actions.forEach((action, index) => {
    if (action.elementId) {
      action.elementId = resolveAlias(action.slideId, action.elementId);
    }
    if (action.type === 'add_element' && action.element?.type) {
      const requestedId = action.element.id || createSafeId('element', `${action.slideId || 'slide'}-${action.element.type}`, index);
      const label = `${action.slideId || 'slide'}-${requestedId.replace(/^element-/, '')}`;
      const nextId = allocateUniqueId(usedIds, 'element', label, index);
      action.element.id = nextId;
      if (requestedId !== nextId) {
        aliases.set(`${action.slideId || ''}::${requestedId}`, nextId);
        aliases.set(`*::${requestedId}`, nextId);
      }
    }
    const configs = [
      action.element?.actionConfig,
      ...(Array.isArray(action.element?.interactionTriggers)
        ? action.element.interactionTriggers.map((trigger) => trigger?.actionConfig)
        : []),
      ...(Array.isArray(action.element?.videoTriggers)
        ? action.element.videoTriggers.map((trigger) => trigger?.actionConfig)
        : [])
    ];
    configs.forEach((config) => {
      if (!config || typeof config !== 'object') {
        return;
      }
      if (config.targetElementId) {
        config.targetElementId = resolveAlias(action.slideId, config.targetElementId);
      }
      if (typeof config.detectorAcceptedDrag === 'string' && config.detectorAcceptedDrag.startsWith('element:')) {
        const requestedId = config.detectorAcceptedDrag.slice('element:'.length);
        config.detectorAcceptedDrag = `element:${resolveAlias(action.slideId, requestedId)}`;
      }
    });
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
  if (value.includes('tecla') || value.includes('key') || value.includes('keyboard')) return 'key';
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
    backgroundFillType: slide.backgroundFillType || null,
    backgroundGradientStart: slide.backgroundGradientStart || null,
    backgroundGradientEnd: slide.backgroundGradientEnd || null,
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

function constrainActionGeometry(actions, stageSize = DEFAULT_STAGE_SIZE) {
  const stageWidth = Math.max(320, Number(stageSize?.width) || DEFAULT_STAGE_SIZE.width);
  const stageHeight = Math.max(180, Number(stageSize?.height) || DEFAULT_STAGE_SIZE.height);
  const defaultSizes = {
    text: [360, 100],
    block: [360, 180],
    image: [360, 240],
    quiz: [520, 360],
    floatingButton: [180, 60],
    key: [220, 86],
    detector: [180, 120],
    input: [460, 280],
    timedTrigger: [120, 80],
    audio: [300, 72],
    video: [420, 236],
    camera: [360, 270]
  };
  actions.forEach((action) => {
    if (!['add_element', 'update_element'].includes(action.type) || !action.element) {
      return;
    }
    const element = action.element;
    const isAdd = action.type === 'add_element';
    const [defaultWidth, defaultHeight] = defaultSizes[element.type] || [280, 160];
    let width = Number(element.width);
    let height = Number(element.height);
    if (isAdd && (!Number.isFinite(width) || width <= 0)) width = defaultWidth;
    if (isAdd && (!Number.isFinite(height) || height <= 0)) height = defaultHeight;
    if (Number.isFinite(width)) element.width = Math.min(stageWidth, Math.max(40, width));
    if (Number.isFinite(height)) element.height = Math.min(stageHeight, Math.max(40, height));
    if (element.type === 'quiz') {
      element.width = Math.min(stageWidth, Math.max(400, Number(element.width) || defaultWidth));
      element.height = Math.min(stageHeight, Math.max(300, Number(element.height) || defaultHeight));
    }
    if (isAdd || Number.isFinite(Number(element.x))) {
      const maxX = Math.max(0, stageWidth - (Number(element.width) || 0));
      element.x = Math.min(maxX, Math.max(0, Number(element.x) || 0));
    }
    if (isAdd || Number.isFinite(Number(element.y))) {
      const maxY = Math.max(0, stageHeight - (Number(element.height) || 0));
      element.y = Math.min(maxY, Math.max(0, Number(element.y) || 0));
    }
  });
  return actions;
}

function applyImagePolicyToActions(actions, request, currentPlanItem = null) {
  const policy = currentPlanItem?.imageIntent || inferRequestedImagePolicy(request);
  if (policy !== 'none') {
    return actions;
  }
  const shouldPreserveImageSpace = requestAsksToPreserveImageSpace(request);
  return actions
    .map((action, index) => {
      if (action.slide) {
        delete action.slide.backgroundImage;
        delete action.slide.backgroundImagePrompt;
      }
      if (action.element?.actionConfig) {
        delete action.element.actionConfig.generationPrompt;
      }
      if (action.type === 'add_element' && action.element?.type === 'image') {
        if (!shouldPreserveImageSpace) {
          return null;
        }
        const element = action.element;
        action.element = {
          id: element.id || createSafeId('element', 'espaco-imagem', index),
          type: 'block',
          content: 'Espaco da imagem',
          x: Number(element.x) || 760,
          y: Number(element.y) || 150,
          width: Math.max(180, Number(element.width) || 320),
          height: Math.max(140, Number(element.height) || 220),
          backgroundColor: '#f5efe2',
          solidColor: '#f5efe2',
          textColor: '#8a6a2b',
          textAlign: 'center',
          fontSize: 20,
          fontWeight: '600',
          hasTextBlock: true
        };
      }
      if (action?.element?.actionConfig?.type === 'addImage' && shouldPreserveImageSpace) {
        action.element.actionConfig.type = 'addText';
        action.element.actionConfig.text = 'Espaco da imagem';
        delete action.element.actionConfig.url;
      }
      return action;
    })
    .filter(Boolean);
}

function requestAsksToPreserveImageSpace(request = '') {
  const normalizedRequest = normalizeReferenceText(request);
  return /\b(espac\w*|espa\S*|area\w*|local\w*)\b[\s\S]{0,40}\b(imagem|imagens|foto|fotos|ilustracao|ilustracoes)\b/i.test(normalizedRequest);
}

function ensureImageSpacePlaceholder(actions = [], request = '', currentPlanItem = null, stageSize = DEFAULT_STAGE_SIZE) {
  const policy = currentPlanItem?.imageIntent || inferRequestedImagePolicy(request);
  if (policy !== 'none' || !requestAsksToPreserveImageSpace(request) || !Array.isArray(actions)) {
    return actions;
  }
  const targetSlideId = currentPlanItem?.targetSlideId
    || currentPlanItem?.id
    || actions.find((action) => action?.slideId)?.slideId
    || actions.find((action) => action?.slide?.id)?.slide?.id
    || null;
  if (!targetSlideId) {
    return actions;
  }
  const hasPlaceholder = actions.some((action) =>
    action?.slideId === targetSlideId
    && action?.element?.type === 'block'
    && /espaco da imagem/i.test(normalizeReferenceText(action.element.content || ''))
  );
  if (hasPlaceholder) {
    return actions;
  }
  const stageWidth = Math.max(320, Number(stageSize?.width) || DEFAULT_STAGE_SIZE.width);
  actions.push({
    type: 'add_element',
    slideId: targetSlideId,
    reason: 'Reservar visualmente o espaco de imagem sem gerar imagem por IA.',
    element: {
      id: createSafeId('element', `${targetSlideId}-espaco-imagem`, actions.length),
      type: 'block',
      content: 'Espaco da imagem',
      x: Math.max(640, stageWidth - 548),
      y: 150,
      width: 480,
      height: 300,
      backgroundColor: '#f5efe2',
      solidColor: '#f5efe2',
      textColor: '#8a6a2b',
      textAlign: 'center',
      fontSize: 20,
      fontWeight: '600',
      hasTextBlock: true,
      zIndex: 2
    }
  });
  return actions;
}

function actionListHasGeneratedImage(actions = []) {
  return actions.some((action) => (
    Boolean(action?.slide?.backgroundImagePrompt || action?.slide?.backgroundImage) ||
    (action?.type === 'add_element' && action.element?.type === 'image' && (action.element.generationPrompt || action.element.src)) ||
    (action?.element?.actionConfig?.type === 'addImage' && (action.element.actionConfig.generationPrompt || action.element.actionConfig.url))
  ));
}

function buildRequiredImagePrompt(request, currentPlanItem = null) {
  const parts = [
    `Tema da aula: ${request || 'aula interativa'}.`,
    currentPlanItem?.title ? `Slide: ${currentPlanItem.title}.` : '',
    currentPlanItem?.goal ? `Objetivo pedagogico: ${currentPlanItem.goal}.` : '',
    currentPlanItem?.layoutNotes ? `Contexto visual: ${currentPlanItem.layoutNotes}.` : '',
    'Crie uma imagem educacional clara, sem texto pequeno, com composicao limpa e alto contraste.',
    'A imagem deve funcionar como ilustracao principal do slide e combinar com a paleta visual da aula.'
  ].filter(Boolean);
  return parts.join(' ');
}

function stripLeadingInstructionVerb(text = '') {
  return String(text || '')
    .trim()
    .replace(/^(definir|explicar|apresentar|descrever|mostrar|comparar|relacionar|identificar|analisar|contextualizar|destacar|criar|inserir|usar|colocar|organizar|reservar|montar|adicionar|revelar)\s+/i, '')
    .trim();
}

function looksLikePlannerInstructionText(value = '', currentPlanItem = null) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  const normalized = normalizeReferenceText(text);
  const planTexts = [
    currentPlanItem?.goal,
    currentPlanItem?.layoutNotes,
    currentPlanItem?.interactionNotes,
    currentPlanItem?.deliverable
  ]
    .map((item) => normalizeReferenceText(item || ''))
    .filter(Boolean);
  if (planTexts.includes(normalized)) {
    return true;
  }
  if (/^(definir|explicar|apresentar|descrever|mostrar|comparar|relacionar|identificar|analisar|contextualizar|destacar|criar|inserir|usar|colocar|organizar|reservar|montar|adicionar|revelar)\b/.test(normalized)) {
    return true;
  }
  return /\b(titulo|conteudo|area de imagem|area de interacao|rodape|margem|reserve|layout|gatilho|detector|floatingbutton|generationprompt|targetslideid|slide atual)\b/.test(normalized);
}

function getStudentFacingReplacement(value = '', currentPlanItem = null, kind = 'body') {
  return convertInstructionToLessonText(value, currentPlanItem, kind);
}

function convertInstructionToLessonText(value = '', currentPlanItem = null, kind = 'body') {
  const raw = String(value || '').trim();
  const title = String(currentPlanItem?.title || '').trim() || 'Tema da aula';
  const titleTopic = title
    .replace(/^o\s+/i, '')
    .replace(/[?:!.]+$/g, '')
    .trim();
  const cleaned = stripLeadingInstructionVerb(raw)
    .replace(/\s+como\s+pratica\b/i, ' como pratica')
    .trim();
  const normalizedTitle = normalizeReferenceText(title);
  const normalizedGoal = normalizeReferenceText(raw);

  if (/escambo/.test(normalizedTitle) || /escambo/.test(normalizedGoal)) {
    if (kind === 'subtitle') {
      return 'Uma forma de troca direta usada nos primeiros contatos coloniais.';
    }
    return 'O escambo era a troca direta de produtos e servicos, sem uso de dinheiro. No Brasil colonial, envolveu contatos entre portugueses e povos indigenas.';
  }

  if (cleaned && cleaned.length >= 20 && !looksLikePlannerInstructionText(cleaned, { ...currentPlanItem, goal: '' })) {
    return truncateText(cleaned, kind === 'subtitle' ? 150 : 240);
  }

  if (kind === 'subtitle') {
    return `Entenda ${titleTopic || title} com exemplos claros e linguagem simples.`;
  }
  return `Este slide apresenta ${titleTopic || title} de forma clara, conectando conceito, contexto e exemplo para facilitar a aprendizagem.`;
}

function sanitizePlannerInstructionLeaks(actions = [], currentPlanItem = null) {
  if (!currentPlanItem || !Array.isArray(actions)) {
    return actions;
  }
  let replacementIndex = 0;
  return actions.map((action) => {
    if (!action?.element) {
      return action;
    }
    const element = action.element;
    if (typeof element.content === 'string' && looksLikePlannerInstructionText(element.content, currentPlanItem)) {
      const isSubtitle = /subtitulo|subtitle|apoio|descricao/i.test(String(element.id || '')) || Number(element.y) < 240;
      element.content = getStudentFacingReplacement(element.content, currentPlanItem, isSubtitle ? 'subtitle' : 'body');
      replacementIndex += 1;
    }
    if (typeof element.label === 'string' && looksLikePlannerInstructionText(element.label, currentPlanItem)) {
      element.label = replacementIndex > 0 ? 'Continuar' : 'Comecar';
      replacementIndex += 1;
    }
    if (typeof element.question === 'string' && looksLikePlannerInstructionText(element.question, currentPlanItem)) {
      element.question = `Qual afirmacao resume melhor "${currentPlanItem.title || 'este tema'}"?`;
      replacementIndex += 1;
    }
    if (Array.isArray(element.options)) {
      element.options = element.options.map((option, index) =>
        looksLikePlannerInstructionText(option, currentPlanItem)
          ? ['A ideia principal do slide', 'Um detalhe secundario', 'Uma resposta incorreta'][index] || `Opcao ${index + 1}`
          : option
      );
    }
    if (element.actionConfig && typeof element.actionConfig === 'object') {
      sanitizeActionConfigInstructionLeaks(element.actionConfig, currentPlanItem);
    }
    if (Array.isArray(element.interactionTriggers)) {
      element.interactionTriggers.forEach((trigger) => {
        if (trigger?.actionConfig && typeof trigger.actionConfig === 'object') {
          sanitizeActionConfigInstructionLeaks(trigger.actionConfig, currentPlanItem);
        }
      });
    }
    if (Array.isArray(element.videoTriggers)) {
      element.videoTriggers.forEach((trigger) => {
        if (trigger?.actionConfig && typeof trigger.actionConfig === 'object') {
          sanitizeActionConfigInstructionLeaks(trigger.actionConfig, currentPlanItem);
        }
      });
    }
    return action;
  });
}

function sanitizeActionConfigInstructionLeaks(config = {}, currentPlanItem = null) {
  ['text', 'replaceText', 'quizQuestion', 'successMessage', 'errorMessage', 'actionLabel'].forEach((key) => {
    if (typeof config[key] === 'string' && looksLikePlannerInstructionText(config[key], currentPlanItem)) {
      if (key === 'quizQuestion') {
        config[key] = `Qual afirmacao resume melhor "${currentPlanItem?.title || 'este tema'}"?`;
      } else if (key === 'actionLabel') {
        config[key] = 'Continuar';
      } else {
        config[key] = getStudentFacingReplacement(config[key], currentPlanItem, key.includes('Message') ? 'subtitle' : 'body');
      }
    }
  });
  if (Array.isArray(config.quizOptions)) {
    config.quizOptions = config.quizOptions.map((option, index) =>
      looksLikePlannerInstructionText(option, currentPlanItem)
        ? ['A ideia principal do slide', 'Um detalhe secundario', 'Uma resposta incorreta'][index] || `Opcao ${index + 1}`
        : option
    );
  }
  return config;
}

function ensureRequiredImageGeneration(actions, request, currentPlanItem = null, stageSize = DEFAULT_STAGE_SIZE) {
  if (!currentPlanItem || currentPlanItem.imageIntent !== 'required' || actionListHasGeneratedImage(actions)) {
    return actions;
  }
  const targetSlideId = currentPlanItem.targetSlideId || currentPlanItem.id;
  if (!targetSlideId) {
    return actions;
  }
  const stageWidth = Math.max(320, Number(stageSize?.width) || DEFAULT_STAGE_SIZE.width);
  const imageWidth = Math.min(440, Math.max(320, Math.round(stageWidth * 0.34)));
  return [
    ...actions,
    {
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Garantir imagem gerada por IA neste slide planejado com imageIntent required.',
      element: {
        id: 'imagem-ilustrativa',
        type: 'image',
        generationPrompt: buildRequiredImagePrompt(request, currentPlanItem),
        x: Math.max(720, stageWidth - imageWidth - 96),
        y: 176,
        width: imageWidth,
        height: 300,
        objectFit: 'cover',
        animationType: 'fade-in',
        animationDuration: 0.7
      }
    }
  ];
}

function repairDragDropDetectorConfiguration(actions = [], existingSlides = [], currentPlanItem = null) {
  if (!Array.isArray(actions) || !actions.length || currentPlanItem?.interactionType !== 'drag-drop') {
    return actions;
  }
  const targetSlideId = currentPlanItem.targetSlideId || currentPlanItem.id || null;
  if (!targetSlideId) {
    return actions;
  }
  const slideActions = actions.filter((action) => action?.slideId === targetSlideId && ['add_element', 'update_element'].includes(action.type) && action.element);
  if (!slideActions.length) {
    return actions;
  }

  const draggableAction = slideActions.find((action) => action.element?.studentCanDrag === true);
  const detectorAction = slideActions.find((action) => action.element?.type === 'detector');
  if (!draggableAction || !detectorAction) {
    return actions;
  }

  const visualTargetRegex = /\b(solte aqui|arraste aqui|encaixe|destino|local correto|resposta)\b/i;
  const feedbackRegex = /\b(correto|muito bem|acertou|boa|parabens)\b/i;
  const visualTargetAction =
    slideActions.find((action) => {
      const element = action.element;
      return element?.id !== detectorAction.element?.id
        && element?.id !== draggableAction.element?.id
        && ['block', 'text', 'image'].includes(element?.type)
        && visualTargetRegex.test(String(element?.content || element?.label || ''));
    })
    || slideActions.find((action) => {
      const element = action.element;
      return element?.id !== detectorAction.element?.id
        && element?.id !== draggableAction.element?.id
        && ['block', 'image'].includes(element?.type)
        && !element?.initiallyHidden;
    });

  if (visualTargetAction?.element) {
    detectorAction.element.x = Number(visualTargetAction.element.x) || 0;
    detectorAction.element.y = Number(visualTargetAction.element.y) || 0;
    detectorAction.element.width = Math.max(40, Number(visualTargetAction.element.width) || Number(detectorAction.element.width) || 180);
    detectorAction.element.height = Math.max(40, Number(visualTargetAction.element.height) || Number(detectorAction.element.height) || 120);
  }

  let feedbackAction = slideActions.find((action) => {
    const element = action.element;
    return element?.id !== detectorAction.element?.id
      && element?.id !== draggableAction.element?.id
      && ['block', 'text'].includes(element?.type)
      && feedbackRegex.test(String(element?.content || element?.label || ''));
  });

  if (feedbackAction?.element) {
    feedbackAction.element.initiallyHidden = true;
  } else {
    const feedbackId = createSafeId('element', `${targetSlideId}-feedback-correto`, actions.length);
    feedbackAction = {
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Adicionar feedback oculto para ser revelado quando a peca for arrastada para o alvo correto.',
      element: {
        id: feedbackId,
        type: 'block',
        content: 'Correto!',
        x: Math.min(980, (Number(detectorAction.element.x) || 0) + 12),
        y: Math.min(620, (Number(detectorAction.element.y) || 0) + (Number(detectorAction.element.height) || 120) + 18),
        width: 280,
        height: 74,
        fontSize: 24,
        fontWeight: '700',
        textColor: '#15803d',
        backgroundColor: '#ffffff',
        solidColor: '#ffffff',
        initiallyHidden: true,
        zIndex: 4
      }
    };
    actions.push(feedbackAction);
  }

  const feedbackTargetId = feedbackAction.element.id;
  const draggableId = draggableAction.element.id;
  const baseDetectorConfig = {
    type: 'showElement',
    targetElementId: feedbackTargetId,
    detectorAcceptedDrag: `element:${draggableId}`,
    detectorMinMatchCount: 1,
    detectorTriggerOnce: true
  };

  detectorAction.element.actionConfig = {
    ...(detectorAction.element.actionConfig && typeof detectorAction.element.actionConfig === 'object' ? detectorAction.element.actionConfig : {}),
    ...baseDetectorConfig
  };

  const primaryTrigger =
    Array.isArray(detectorAction.element.interactionTriggers) && detectorAction.element.interactionTriggers.length
      ? detectorAction.element.interactionTriggers[0]
      : {
          id: createSafeId('trigger', `${detectorAction.element.id || 'detector'}-ao-encaixar`, 0),
          name: 'Ao encaixar',
          enabled: true,
          actionConfig: {}
        };
  primaryTrigger.enabled = primaryTrigger.enabled !== false;
  primaryTrigger.actionConfig = {
    ...(primaryTrigger.actionConfig && typeof primaryTrigger.actionConfig === 'object' ? primaryTrigger.actionConfig : {}),
    ...baseDetectorConfig
  };
  detectorAction.element.interactionTriggers = [primaryTrigger];
  return actions;
}

function addSupportCardsForReadableContent(actions = [], currentPlanItem = null) {
  if (!Array.isArray(actions) || !actions.length || !currentPlanItem) {
    return actions;
  }
  const targetSlideId = currentPlanItem.targetSlideId || currentPlanItem.id || null;
  if (!targetSlideId) {
    return actions;
  }
  const slideActions = actions.filter((action) => action?.slideId === targetSlideId && ['add_element', 'update_element'].includes(action.type) && action.element);
  const existingCardZones = slideActions
    .filter((action) => action.element?.type === 'block' && !String(action.element?.content || '').trim())
    .map((action) => ({
      x: Number(action.element.x) || 0,
      y: Number(action.element.y) || 0,
      width: Number(action.element.width) || 0,
      height: Number(action.element.height) || 0
    }));

  const textLikeActions = slideActions.filter((action) => {
    const element = action.element;
    if (!['text', 'block'].includes(element?.type)) {
      return false;
    }
    const content = String(element?.content || '').trim();
    if (!content || content.length < 8) {
      return false;
    }
    return Number(element.width) >= 180 && Number(element.height) >= 36;
  });

  textLikeActions.forEach((action, index) => {
    const element = action.element;
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    const width = Number(element.width) || 0;
    const height = Number(element.height) || 0;
    const alreadyBacked = existingCardZones.some((zone) =>
      Math.abs(zone.x - x) <= 24
      && Math.abs(zone.y - y) <= 24
      && Math.abs(zone.width - width) <= 48
      && Math.abs(zone.height - height) <= 48
    );
    if (alreadyBacked) {
      return;
    }
    if (element.type === 'text') {
      element.hasTextBlock = true;
      element.hasTextBackground = true;
      element.backgroundColor = element.backgroundColor || '#fffaf0';
      return;
    }
    const cardId = createSafeId('element', `${targetSlideId}-card-apoio-${index + 1}`, actions.length + index);
    actions.push({
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Adicionar card de apoio atras do conteudo para melhorar legibilidade e acabamento visual.',
      element: {
        id: cardId,
        type: 'block',
        content: '',
        x: Math.max(0, x - 18),
        y: Math.max(0, y - 18),
        width: Math.min(DEFAULT_STAGE_SIZE.width, width + 36),
        height: Math.min(DEFAULT_STAGE_SIZE.height, height + 36),
        backgroundColor: '#fffaf0',
        solidColor: '#fffaf0',
        zIndex: Math.max(0, Number(element.zIndex) || 1) - 1
      }
    });
    existingCardZones.push({
      x: Math.max(0, x - 18),
      y: Math.max(0, y - 18),
      width: Math.min(DEFAULT_STAGE_SIZE.width, width + 36),
      height: Math.min(DEFAULT_STAGE_SIZE.height, height + 36)
    });
  });

  const bulletBlocks = slideActions.filter((action) =>
    action.element?.type === 'block'
    && !String(action.element?.content || '').trim()
    && Number(action.element.width) <= 80
    && Number(action.element.height) <= 80
  );
  bulletBlocks.forEach((action) => {
    const nearbyText = slideActions.some((candidate) => {
      const element = candidate.element;
      if (!['text', 'block'].includes(element?.type) || !String(element?.content || '').trim()) {
        return false;
      }
      const horizontalGap = (Number(element.x) || 0) - ((Number(action.element.x) || 0) + (Number(action.element.width) || 0));
      const verticalGap = Math.abs((Number(element.y) || 0) - (Number(action.element.y) || 0));
      return horizontalGap >= 0 && horizontalGap <= 220 && verticalGap <= 60;
    });
    if (!nearbyText) {
      action.element.content = '•';
      action.element.fontSize = Math.max(28, Number(action.element.fontSize) || 32);
      action.element.textAlign = 'center';
    }
  });

  return actions;
}

function ensureNarrativeForLonelyBulletMarkers(actions = [], currentPlanItem = null) {
  if (!Array.isArray(actions) || !actions.length || !currentPlanItem) {
    return actions;
  }
  const targetSlideId = currentPlanItem.targetSlideId || currentPlanItem.id || null;
  if (!targetSlideId) {
    return actions;
  }
  const slideActions = actions.filter((action) => action?.slideId === targetSlideId && ['add_element', 'update_element'].includes(action.type) && action.element);
  const bulletBlocks = slideActions.filter((action) =>
    action.element?.type === 'block'
    && /^[*•·]?$/.test(String(action.element?.content || '').trim())
    && Number(action.element.width) <= 80
    && Number(action.element.height) <= 80
  );
  if (!bulletBlocks.length) {
    return actions;
  }
  const fallbackNarrative = compactTextForElement(
    convertInstructionToLessonText(currentPlanItem.goal || currentPlanItem.layoutNotes || currentPlanItem.title || '', currentPlanItem, 'body'),
    220
  );
  const narrativeSegments = fallbackNarrative
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((segment) => compactTextForElement(segment, 120))
    .filter((segment) => segment.length >= 18);
  let bulletSegmentIndex = 0;

  bulletBlocks.forEach((action) => {
    const nearbyText = slideActions.some((candidate) => {
      const element = candidate.element;
      if (!['text', 'block'].includes(element?.type) || !String(element?.content || '').trim()) {
        return false;
      }
      const horizontalGap = (Number(element.x) || 0) - ((Number(action.element.x) || 0) + (Number(action.element.width) || 0));
      const verticalGap = Math.abs((Number(element.y) || 0) - (Number(action.element.y) || 0));
      return horizontalGap >= 0 && horizontalGap <= 220 && verticalGap <= 60;
    });
    if (nearbyText) {
      return;
    }

    const bulletX = Number(action.element.x) || 0;
    const bulletY = Number(action.element.y) || 0;
    const bulletWidth = Number(action.element.width) || 44;
    const segment = narrativeSegments[bulletSegmentIndex] || narrativeSegments.at(-1) || fallbackNarrative;
    action.element.content = '*';
    action.element.fontSize = Math.max(28, Number(action.element.fontSize) || 32);
    action.element.textAlign = 'center';
    action.element.textColor = action.element.textColor || '#c26b00';

    if (!segment) {
      return;
    }

    const textX = Math.min(DEFAULT_STAGE_SIZE.width - 360, bulletX + bulletWidth + 18);
    const maxWidth = Math.max(220, DEFAULT_STAGE_SIZE.width - textX - 72);
    actions.push({
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Adicionar texto de apoio ao lado do marcador para evitar lista vazia sem conteudo.',
      element: {
        id: createSafeId('element', `${targetSlideId}-bullet-text-${bulletSegmentIndex + 1}`, actions.length + bulletSegmentIndex),
        type: 'block',
        content: segment,
        x: textX,
        y: Math.max(0, bulletY - 10),
        width: Math.min(420, maxWidth),
        height: 88,
        fontSize: 24,
        fontWeight: '500',
        textAlign: 'left',
        textColor: '#2b3245',
        backgroundColor: '#fffaf0',
        solidColor: '#fffaf0',
        zIndex: Math.max(1, Number(action.element.zIndex) || 2)
      }
    });
    bulletSegmentIndex += 1;
  });

  return actions;
}

function resolveCurrentVisualTheme(request, currentPlanItem = null, executionPlan = null) {
  return currentPlanItem?.visualTheme || executionPlan?.visualTheme || inferDeckVisualTheme(request);
}

function isThemeColor(value, theme = null) {
  if (!isHexColor(value) || !theme?.palette) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return Object.values(theme.palette).some((color) => String(color || '').trim().toLowerCase() === normalized);
}

function isDefaultishColor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['#ffffff', '#fff', '#fdfbff', '#f4f6ff', '#eef2ff', '#dfe6ff', '#000000', '#000'].includes(normalized);
}

function pickThemeSurface(theme, index = 0) {
  return index % 2 === 0
    ? getThemeColor(theme, 'surface', '#ffffff')
    : getThemeColor(theme, 'surfaceAlt', '#ede9fe');
}

function applyThemeToElement(element = {}, theme = null, index = 0) {
  if (!element || !theme?.palette) {
    return element;
  }
  const text = getThemeColor(theme, 'text', '#171934');
  const mutedText = getThemeColor(theme, 'mutedText', '#4b5563');
  const surface = pickThemeSurface(theme, index);
  const primary = getThemeColor(theme, 'primary', '#6d5dfc');
  const secondary = getThemeColor(theme, 'secondary', '#0891b2');
  const accent = getThemeColor(theme, 'accent', '#f97316');

  if (element.type === 'text') {
    if (!element.textColor || isDefaultishColor(element.textColor) || !isThemeColor(element.textColor, theme)) {
      element.textColor = text;
    }
    if (element.hasTextBackground || element.hasTextBlock) {
      element.backgroundColor = isThemeColor(element.backgroundColor, theme) ? element.backgroundColor : surface;
    }
    return element;
  }

  if (element.type === 'block') {
    const hasContent = Boolean(String(element.content || '').trim());
    element.backgroundColor = isThemeColor(element.backgroundColor, theme) ? element.backgroundColor : surface;
    element.solidColor = isThemeColor(element.solidColor, theme) ? element.solidColor : element.backgroundColor;
    const blockBg = String(element.backgroundColor || '').trim().toLowerCase();
    const strongBackgrounds = [primary, secondary, accent, getThemeColor(theme, 'danger', '#e11d48')]
      .map((color) => String(color || '').trim().toLowerCase());
    element.textColor = strongBackgrounds.includes(blockBg)
      ? '#ffffff'
      : isThemeColor(element.textColor, theme)
        ? element.textColor
        : text;
    if (hasContent) {
      element.useGradient = false;
      element.gradientStart = element.backgroundColor;
      element.gradientEnd = element.backgroundColor;
    } else if (element.useGradient) {
      element.gradientStart = isThemeColor(element.gradientStart, theme) ? element.gradientStart : element.backgroundColor;
      element.gradientEnd = isThemeColor(element.gradientEnd, theme) ? element.gradientEnd : secondary;
    }
    return element;
  }

  if (element.type === 'floatingButton' || element.type === 'key') {
    element.useGradient = true;
    element.gradientStart = primary;
    element.gradientEnd = accent;
    element.backgroundColor = primary;
    element.solidColor = primary;
    element.textColor = '#ffffff';
    return element;
  }

  if (element.type === 'quiz') {
    element.quizBackgroundColor = getThemeColor(theme, 'surface', '#ffffff');
    element.quizQuestionColor = text;
    element.quizOptionBackgroundColor = getThemeColor(theme, 'backgroundAlt', '#eff6ff');
    element.quizOptionTextColor = text;
    element.quizButtonBackgroundColor = primary;
    return element;
  }

  if (element.type === 'input') {
    element.backgroundColor = getThemeColor(theme, 'surface', '#ffffff');
    element.labelColor = mutedText;
    element.inputTextColor = text;
    element.submitButtonColor = primary;
    element.submitButtonTextColor = '#ffffff';
    return element;
  }

  return element;
}

function applyDeckVisualThemeToActions(actions, request, currentPlanItem = null, executionPlan = null) {
  const isDeckItem = Boolean(currentPlanItem || executionPlan?.mode === 'deck');
  if (!isDeckItem || !Array.isArray(actions)) {
    return actions;
  }
  const theme = resolveCurrentVisualTheme(request, currentPlanItem, executionPlan);
  const orderIndex = Math.max(0, Number(currentPlanItem?.order || 1) - 1);
  const slideStyle = currentPlanItem?.slideStyle || getThemeSlideStyle(theme, orderIndex);

  actions.forEach((action, index) => {
    if ((action.type === 'add_slide' || action.type === 'update_slide') && action.slide) {
      const hasImageBackground = Boolean(action.slide.backgroundImage || action.slide.backgroundImagePrompt);
      action.slide.backgroundColor = slideStyle.backgroundColor;
      if (!hasImageBackground) {
        action.slide.backgroundFillType = slideStyle.backgroundFillType;
        action.slide.backgroundGradientStart = slideStyle.backgroundGradientStart;
        action.slide.backgroundGradientEnd = slideStyle.backgroundGradientEnd;
      }
    }
    if ((action.type === 'add_element' || action.type === 'update_element') && action.element) {
      applyThemeToElement(action.element, theme, index);
    }
  });

  return actions;
}

function getElementLayoutBox(element = {}, extraMargin = 0) {
  const x = Number(element.x) || 0;
  const y = Number(element.y) || 0;
  const width = Math.max(0, Number(element.width) || 0);
  const height = Math.max(0, Number(element.height) || 0);
  return {
    x: x - extraMargin,
    y: y - extraMargin,
    width: width + extraMargin * 2,
    height: height + extraMargin * 2,
    right: x + width + extraMargin,
    bottom: y + height + extraMargin
  };
}

function layoutBoxesOverlap(first, second) {
  return first.x < second.right && first.right > second.x && first.y < second.bottom && first.bottom > second.y;
}

function getLayoutOverlapRatio(first, second) {
  if (!layoutBoxesOverlap(first, second)) {
    return 0;
  }
  const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.y, second.y));
  const overlapArea = overlapWidth * overlapHeight;
  const firstArea = Math.max(1, Number(first.width) * Number(first.height));
  const secondArea = Math.max(1, Number(second.width) * Number(second.height));
  return overlapArea / Math.min(firstArea, secondArea);
}

function isBoxInside(inner, outer, padding = 0) {
  return (
    inner.x >= outer.x + padding &&
    inner.y >= outer.y + padding &&
    inner.right <= outer.right - padding &&
    inner.bottom <= outer.bottom - padding
  );
}

function isNonBlockingLayoutElement(element = {}) {
  return ['detector', 'timedTrigger'].includes(element.type);
}

function isDecorativeBlock(element = {}) {
  return element.type === 'block' && !String(element.content || '').trim();
}

function isAllowedLayoutOverlap(candidateElement = {}, blockerElement = {}) {
  if (isNonBlockingLayoutElement(candidateElement) || isNonBlockingLayoutElement(blockerElement)) {
    return true;
  }
  const candidateBox = getElementLayoutBox(candidateElement, 0);
  const blockerBox = getElementLayoutBox(blockerElement, 0);
  if (candidateElement.type === 'text' && isDecorativeBlock(blockerElement) && isBoxInside(candidateBox, blockerBox, 8)) {
    candidateElement.zIndex = Math.max(Number(candidateElement.zIndex) || 0, (Number(blockerElement.zIndex) || 0) + 1);
    return true;
  }
  if (isDecorativeBlock(candidateElement) && blockerElement.type === 'text' && isBoxInside(blockerBox, candidateBox, 8)) {
    blockerElement.zIndex = Math.max(Number(blockerElement.zIndex) || 0, (Number(candidateElement.zIndex) || 0) + 1);
    return true;
  }
  return false;
}

function findFreeLayoutPosition(element, blockers, stageWidth, stageHeight) {
  const width = Math.max(40, Number(element.width) || 280);
  const height = Math.max(40, Number(element.height) || 120);
  const maxX = Math.max(LAYOUT_SAFE_MARGIN, stageWidth - width - LAYOUT_SAFE_MARGIN);
  const maxY = Math.max(LAYOUT_SAFE_MARGIN, stageHeight - height - LAYOUT_SAFE_MARGIN);
  const candidates = [
    [Number(element.x) || LAYOUT_SAFE_MARGIN, Number(element.y) || LAYOUT_SAFE_MARGIN],
    [LAYOUT_SAFE_MARGIN, LAYOUT_SAFE_MARGIN],
    [Math.round((stageWidth - width) / 2), LAYOUT_SAFE_MARGIN],
    [maxX, LAYOUT_SAFE_MARGIN],
    [LAYOUT_SAFE_MARGIN, Math.round((stageHeight - height) / 2)],
    [Math.round((stageWidth - width) / 2), Math.round((stageHeight - height) / 2)],
    [maxX, Math.round((stageHeight - height) / 2)],
    [LAYOUT_SAFE_MARGIN, maxY],
    [Math.round((stageWidth - width) / 2), maxY],
    [maxX, maxY]
  ];

  for (let y = LAYOUT_SAFE_MARGIN; y <= maxY; y += 36) {
    for (let x = LAYOUT_SAFE_MARGIN; x <= maxX; x += 36) {
      candidates.push([x, y]);
    }
  }

  for (const [rawX, rawY] of candidates) {
    const candidate = {
      ...element,
      x: Math.min(maxX, Math.max(LAYOUT_SAFE_MARGIN, Number(rawX) || LAYOUT_SAFE_MARGIN)),
      y: Math.min(maxY, Math.max(LAYOUT_SAFE_MARGIN, Number(rawY) || LAYOUT_SAFE_MARGIN)),
      width,
      height
    };
    const candidateBox = getElementLayoutBox(candidate, LAYOUT_ELEMENT_GAP);
    const hasCollision = blockers.some((blocker) => {
      if (!layoutBoxesOverlap(candidateBox, blocker.box)) {
        return false;
      }
      return !isAllowedLayoutOverlap(candidate, blocker.element);
    });
    if (!hasCollision) {
      return { x: candidate.x, y: candidate.y };
    }
  }

  return {
    x: Math.min(maxX, Math.max(LAYOUT_SAFE_MARGIN, Number(element.x) || LAYOUT_SAFE_MARGIN)),
    y: Math.min(maxY, Math.max(LAYOUT_SAFE_MARGIN, Number(element.y) || LAYOUT_SAFE_MARGIN))
  };
}

function resolveActionLayoutCollisions(actions, existingSlides = [], stageSize = DEFAULT_STAGE_SIZE) {
  const stageWidth = Math.max(320, Number(stageSize?.width) || DEFAULT_STAGE_SIZE.width);
  const stageHeight = Math.max(180, Number(stageSize?.height) || DEFAULT_STAGE_SIZE.height);
  const blockersBySlide = new Map();
  const nextZIndexBySlide = new Map();

  const ensureSlideBucket = (slideId) => {
    if (!blockersBySlide.has(slideId)) {
      const slide = existingSlides.find((entry) => entry?.id === slideId);
      const blockers = (slide?.elements || [])
        .filter((element) => element && !isNonBlockingLayoutElement(element))
        .map((element) => ({
          element,
          box: getElementLayoutBox(element, LAYOUT_ELEMENT_GAP)
        }));
      blockersBySlide.set(slideId, blockers);
      const maxZ = (slide?.elements || []).reduce((max, element) => Math.max(max, Number(element?.zIndex) || 0), 0);
      nextZIndexBySlide.set(slideId, maxZ + 1);
    }
    return blockersBySlide.get(slideId);
  };

  actions.forEach((action) => {
    if (action.type === 'add_slide' && action.slide?.id) {
      blockersBySlide.set(action.slide.id, []);
      nextZIndexBySlide.set(action.slide.id, 1);
      return;
    }
    if (action.type !== 'add_element' || !action.element?.type || !action.slideId) {
      return;
    }
    const element = action.element;
    const blockers = ensureSlideBucket(action.slideId);
    const zIndex = Number(element.zIndex);
    if (!Number.isFinite(zIndex) || zIndex <= 0) {
      element.zIndex = nextZIndexBySlide.get(action.slideId) || 1;
    }
    nextZIndexBySlide.set(action.slideId, Math.max(nextZIndexBySlide.get(action.slideId) || 1, Number(element.zIndex) + 1));

    if (!isNonBlockingLayoutElement(element)) {
      const currentBox = getElementLayoutBox(element, LAYOUT_ELEMENT_GAP);
      const hasCollision = blockers.some((blocker) => {
        if (!layoutBoxesOverlap(currentBox, blocker.box)) {
          return false;
        }
        return !isAllowedLayoutOverlap(element, blocker.element);
      });
      if (hasCollision) {
        const nextPosition = findFreeLayoutPosition(element, blockers, stageWidth, stageHeight);
        element.x = nextPosition.x;
        element.y = nextPosition.y;
      }
      blockers.push({
        element,
        box: getElementLayoutBox(element, LAYOUT_ELEMENT_GAP)
      });
    }
  });

  return actions;
}

function getElementLayoutPriority(element = {}) {
  const id = String(element.id || '').toLowerCase();
  if (id.includes('titulo') || id.includes('title')) return 110;
  if (['quiz', 'image', 'video', 'camera', 'input', 'floatingButton', 'key'].includes(element.type)) return 100;
  if (Number(element.y) <= 90) return 90;
  if (element.type === 'block' && !String(element.content || '').trim()) return 25;
  if (element.type === 'block') return 65;
  if (element.type === 'text') return 55;
  return 50;
}

function repairEmptySupportBlockStacking(actions = []) {
  if (!Array.isArray(actions) || !actions.length) {
    return actions;
  }
  const addElementActions = actions.filter((action) => action?.type === 'add_element' && action.slideId && action.element?.type);
  addElementActions.forEach((action) => {
    const element = action.element;
    if (!isDecorativeBlock(element)) {
      return;
    }
    const elementBox = getElementLayoutBox(element, 0);
    const supportedElements = addElementActions
      .filter((candidate) =>
        candidate !== action
        && candidate.slideId === action.slideId
        && !isDecorativeBlock(candidate.element)
        && !isNonBlockingLayoutElement(candidate.element)
        && layoutBoxesOverlap(elementBox, getElementLayoutBox(candidate.element, 0))
      )
      .map((candidate) => candidate.element);
    if (!supportedElements.length) {
      return;
    }
    const minSupportedZ = supportedElements.reduce(
      (min, supported) => Math.min(min, Number(supported.zIndex) || 1),
      Number.POSITIVE_INFINITY
    );
    element.zIndex = Math.max(0, minSupportedZ - 1);
  });
  return actions.filter((action) => {
    if (action?.type !== 'add_element' || !isDecorativeBlock(action.element)) {
      return true;
    }
    const elementBox = getElementLayoutBox(action.element, 0);
    return addElementActions.some((candidate) =>
      candidate !== action
      && candidate.slideId === action.slideId
      && !isDecorativeBlock(candidate.element)
      && !isNonBlockingLayoutElement(candidate.element)
      && layoutBoxesOverlap(elementBox, getElementLayoutBox(candidate.element, 0))
    );
  });
}

function repairRemainingLayoutConflicts(actions = [], existingSlides = []) {
  if (!Array.isArray(actions)) {
    return actions;
  }
  const removableActionIndexes = new Set();
  const elementsBySlide = new Map();
  const addEntry = (slideId, element, actionIndex) => {
    if (!slideId || !element?.type || isNonBlockingLayoutElement(element)) return;
    if (!elementsBySlide.has(slideId)) elementsBySlide.set(slideId, []);
    elementsBySlide.get(slideId).push({ element, actionIndex });
  };

  existingSlides.forEach((slide) => {
    (slide?.elements || []).forEach((element) => addEntry(slide.id, element, -1));
  });
  actions.forEach((action, actionIndex) => {
    if (action?.type === 'add_element') {
      addEntry(action.slideId, action.element, actionIndex);
    }
  });

  elementsBySlide.forEach((entries) => {
    for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
        const first = entries[firstIndex];
        const second = entries[secondIndex];
        if (first.actionIndex < 0 && second.actionIndex < 0) continue;
        if (isAllowedLayoutOverlap(first.element, second.element)) continue;
        const ratio = getLayoutOverlapRatio(getElementLayoutBox(first.element, 0), getElementLayoutBox(second.element, 0));
        if (ratio < 0.12) continue;
        const firstPriority = getElementLayoutPriority(first.element);
        const secondPriority = getElementLayoutPriority(second.element);
        const loser = first.actionIndex >= 0 && (firstPriority <= secondPriority || second.actionIndex < 0) ? first : second;
        if (loser.actionIndex >= 0 && getElementLayoutPriority(loser.element) <= 90) {
          removableActionIndexes.add(loser.actionIndex);
        }
      }
    }
  });

  if (!removableActionIndexes.size) {
    return actions;
  }
  return actions.filter((_, index) => !removableActionIndexes.has(index));
}

function getElementTextValue(element = {}) {
  if (!element || typeof element !== 'object') return '';
  if (typeof element.content === 'string') return element.content;
  if (typeof element.label === 'string') return element.label;
  if (typeof element.question === 'string') return element.question;
  return '';
}

function setElementTextValue(element = {}, value = '') {
  if (typeof element.content === 'string') {
    element.content = value;
    return;
  }
  if (typeof element.label === 'string') {
    element.label = value;
    return;
  }
  if (typeof element.question === 'string') {
    element.question = value;
  }
}

function estimateTextCapacity(element = {}) {
  const width = Math.max(80, Number(element.width) || 280);
  const height = Math.max(40, Number(element.height) || 100);
  const fontSize = Math.max(12, Number(element.fontSize) || (element.type === 'text' ? 22 : 20));
  const avgCharWidth = Math.max(6, fontSize * 0.52);
  const lineHeight = fontSize * 1.32;
  const usableWidth = Math.max(40, width - 28);
  const usableHeight = Math.max(24, height - 24);
  const charsPerLine = Math.max(8, Math.floor(usableWidth / avgCharWidth));
  const lines = Math.max(1, Math.floor(usableHeight / lineHeight));
  return Math.max(20, charsPerLine * lines);
}

function compactTextForElement(text = '', maxChars = 120) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let next = '';
  for (const sentence of sentences) {
    const candidate = next ? `${next} ${sentence}` : sentence;
    if (candidate.length > maxChars) break;
    next = candidate;
  }
  return truncateText(next || clean, maxChars);
}

function sanitizeTextElementFit(element = {}, stageSize = DEFAULT_STAGE_SIZE) {
  const text = getElementTextValue(element);
  if (!text || !['text', 'block', 'floatingButton', 'quiz'].includes(element.type)) {
    return;
  }
  const stageWidth = Math.max(320, Number(stageSize?.width) || DEFAULT_STAGE_SIZE.width);
  const stageHeight = Math.max(180, Number(stageSize?.height) || DEFAULT_STAGE_SIZE.height);
  let fontSize = Math.max(12, Number(element.fontSize) || (element.type === 'text' ? 22 : 20));
  let capacity = estimateTextCapacity({ ...element, fontSize });
  if (text.length <= capacity) {
    return;
  }

  while (fontSize > 15 && text.length > capacity) {
    fontSize -= 1;
    capacity = estimateTextCapacity({ ...element, fontSize });
  }
  element.fontSize = fontSize;

  if (text.length > capacity && element.type !== 'floatingButton') {
    const currentHeight = Math.max(40, Number(element.height) || 100);
    const maxHeight = Math.max(currentHeight, stageHeight - Math.max(LAYOUT_SAFE_MARGIN, Number(element.y) || 0) - LAYOUT_SAFE_MARGIN);
    element.height = Math.min(maxHeight, Math.ceil(currentHeight * 1.35));
    capacity = estimateTextCapacity(element);
  }
  if (text.length > capacity && element.type !== 'floatingButton') {
    const currentWidth = Math.max(80, Number(element.width) || 280);
    const maxWidth = Math.max(currentWidth, stageWidth - Math.max(LAYOUT_SAFE_MARGIN, Number(element.x) || 0) - LAYOUT_SAFE_MARGIN);
    element.width = Math.min(maxWidth, Math.ceil(currentWidth * 1.2));
    capacity = estimateTextCapacity(element);
  }
  if (text.length > capacity) {
    setElementTextValue(element, compactTextForElement(text, Math.max(50, Math.floor(capacity * 0.92))));
  }
}

function sanitizeActionTextFit(actions = [], stageSize = DEFAULT_STAGE_SIZE) {
  if (!Array.isArray(actions)) {
    return actions;
  }
  actions.forEach((action) => {
    if (!action?.element) return;
    sanitizeTextElementFit(action.element, stageSize);
    if (action.element.actionConfig && typeof action.element.actionConfig === 'object') {
      ['text', 'replaceText'].forEach((key) => {
        if (typeof action.element.actionConfig[key] === 'string') {
          action.element.actionConfig[key] = compactTextForElement(action.element.actionConfig[key], 180);
        }
      });
    }
  });
  return actions;
}

function collectActionQualityIssues(actions = [], existingSlides = [], stageSize = DEFAULT_STAGE_SIZE, currentPlanItem = null) {
  const issues = [];
  const stageWidth = Math.max(320, Number(stageSize?.width) || DEFAULT_STAGE_SIZE.width);
  const stageHeight = Math.max(180, Number(stageSize?.height) || DEFAULT_STAGE_SIZE.height);
  const elementsBySlide = new Map();
  const addElement = (slideId, element) => {
    if (!slideId || !element?.type || isNonBlockingLayoutElement(element)) return;
    if (!elementsBySlide.has(slideId)) elementsBySlide.set(slideId, []);
    elementsBySlide.get(slideId).push(element);
  };

  existingSlides.forEach((slide) => {
    (slide?.elements || []).forEach((element) => addElement(slide.id, element));
  });

  actions.forEach((action) => {
    const element = action?.element;
    if (!element) return;
    [
      element.content,
      element.label,
      element.question,
      ...(Array.isArray(element.options) ? element.options : []),
      element.actionConfig?.text,
      element.actionConfig?.replaceText,
      element.actionConfig?.quizQuestion,
      ...(Array.isArray(element.actionConfig?.quizOptions) ? element.actionConfig.quizOptions : []),
      ...[...(Array.isArray(element.interactionTriggers) ? element.interactionTriggers : []), ...(Array.isArray(element.videoTriggers) ? element.videoTriggers : [])]
        .flatMap((trigger) => [
          trigger?.actionConfig?.text,
          trigger?.actionConfig?.replaceText,
          trigger?.actionConfig?.quizQuestion,
          ...(Array.isArray(trigger?.actionConfig?.quizOptions) ? trigger.actionConfig.quizOptions : [])
        ])
    ].forEach((value) => {
      if (typeof value === 'string' && looksLikePlannerInstructionText(value, currentPlanItem)) {
        issues.push({ code: 'instruction_leak', message: `Texto interno apareceu no slide: "${truncateText(value, 80)}"` });
      }
    });

    const text = getElementTextValue(element);
    if (text && text.length > Math.max(estimateTextCapacity(element) * 1.18, 90)) {
      issues.push({ code: 'too_much_text', message: `Texto grande demais para a caixa do elemento ${element.id || element.type}.` });
    }

    const box = getElementLayoutBox(element, 0);
    if (box.x < 0 || box.y < 0 || box.right > stageWidth || box.bottom > stageHeight) {
      issues.push({ code: 'layout_overflow', message: `Elemento ${element.id || element.type} sai dos limites do palco.` });
    }

    addElement(action.slideId, element);
  });

  elementsBySlide.forEach((elements, slideId) => {
    if (elements.length > 14) {
      issues.push({ code: 'too_many_elements', message: `Slide ${slideId} tem elementos demais para um layout limpo.` });
    }
    for (let firstIndex = 0; firstIndex < elements.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < elements.length; secondIndex += 1) {
        const first = elements[firstIndex];
        const second = elements[secondIndex];
        if (isAllowedLayoutOverlap(first, second)) continue;
        const overlapRatio = getLayoutOverlapRatio(getElementLayoutBox(first, 0), getElementLayoutBox(second, 0));
        if (overlapRatio >= 0.12) {
          issues.push({
            code: 'text_overlap',
            message: `Elementos sobrepostos no slide ${slideId}: ${first.id || first.type} e ${second.id || second.type}.`
          });
        }
      }
    }
  });

  return issues;
}

function buildQualityRetryInstruction(issues = []) {
  const unique = [];
  issues.forEach((issue) => {
    if (!unique.some((entry) => entry.code === issue.code)) {
      unique.push(issue);
    }
  });
  return [
    'Sua resposta anterior gerou um slide visualmente invalido. Refaça o JSON do slide inteiro.',
    'Nao copie goal, layoutNotes ou interactionNotes para o palco; transforme em texto final para aluno.',
    'Use no maximo 2 blocos grandes de texto, cards curtos, fonte menor quando necessario e margem entre todos os elementos.',
    'Nao sobreponha textos, cards, imagens, quiz ou botoes. Se faltar espaco, resuma o texto.',
    `Problemas detectados: ${unique.map((issue) => `${issue.code}: ${issue.message}`).join(' | ')}`
  ].join(' ');
}

function assertActionQuality(actions = [], existingSlides = [], stageSize = DEFAULT_STAGE_SIZE, currentPlanItem = null) {
  const issues = collectActionQualityIssues(actions, existingSlides, stageSize, currentPlanItem);
  if (issues.length) {
    const error = new Error(`A IA gerou um slide com problemas de layout/conteudo: ${issues.map((issue) => issue.code).join(', ')}`);
    error.code = 'AI_SLIDE_QUALITY_FAILED';
    error.issues = issues;
    throw error;
  }
  return actions;
}

function planItemHasRenderableContent(actions, currentPlanItem, existingSlides = []) {
  if (!currentPlanItem) {
    return true;
  }
  const targetSlideId = currentPlanItem.targetSlideId || currentPlanItem.id;
  const existingSlide = existingSlides.find((slide) => slide?.id === targetSlideId);
  const projectedElements = [
    ...(existingSlide?.elements || []),
    ...actions
      .filter((action) => action.type === 'add_element' && action.slideId === targetSlideId && action.element?.type)
      .map((action) => action.element)
  ];
  const visibleElements = projectedElements.filter((element) => (
    element?.type &&
    !['detector', 'timedTrigger', 'audio'].includes(element.type) &&
    (element.type !== 'block' || String(element.content || '').trim() || Number(element.width) * Number(element.height) > 50000)
  ));
  if (currentPlanItem.interactionType === 'drag-drop') {
    const hasDraggable = projectedElements.some((element) => element?.studentCanDrag === true);
    const hasDetector = projectedElements.some((element) => element?.type === 'detector');
    return hasDraggable && hasDetector && visibleElements.length >= 2;
  }
  if (currentPlanItem.interactionType === 'quiz') {
    return projectedElements.some((element) => element?.type === 'quiz') && visibleElements.length >= 1;
  }
  if (visibleElements.some((element) => ['image', 'video', 'quiz', 'input'].includes(element.type))) {
    return visibleElements.length >= 1;
  }
  return visibleElements.length >= 2;
}

function ensurePlanItemHasRenderableContent(actions, currentPlanItem, existingSlides = []) {
  if (!currentPlanItem || planItemHasRenderableContent(actions, currentPlanItem, existingSlides)) {
    return actions;
  }
  const targetSlideId = currentPlanItem.targetSlideId || currentPlanItem.id;
  const title = currentPlanItem.title || `Slide ${currentPlanItem.order || ''}`.trim();
  const body = convertInstructionToLessonText(currentPlanItem.goal || currentPlanItem.layoutNotes || '', currentPlanItem, 'body');
  const subtitle = convertInstructionToLessonText(currentPlanItem.goal || currentPlanItem.layoutNotes || '', currentPlanItem, 'subtitle');
  const theme = currentPlanItem.visualTheme || cloneVisualTheme(DEFAULT_DECK_VISUAL_THEMES.at(-1));
  const slideIndex = Math.max(0, Number(currentPlanItem.order || 1) - 1);
  const slideStyle = currentPlanItem.slideStyle || getThemeSlideStyle(theme, slideIndex);
  const existingSlide = existingSlides.find((slide) => slide?.id === targetSlideId);
  const primary = getThemeColor(theme, 'primary', '#6d5dfc');
  const secondary = getThemeColor(theme, 'secondary', '#0891b2');
  const accent = getThemeColor(theme, 'accent', '#f97316');
  const text = getThemeColor(theme, 'text', '#171934');
  const mutedText = getThemeColor(theme, 'mutedText', '#4b5563');
  const surface = getThemeColor(theme, 'surface', '#ffffff');
  const surfaceAlt = getThemeColor(theme, 'surfaceAlt', '#ede9fe');
  const baseActions = [
    ...actions,
    existingSlide
      ? {
          type: 'update_slide',
          slideId: targetSlideId,
          reason: 'Aplicar fundo coerente ao slide planejado.',
          slide: {
            title,
            ...slideStyle
          }
        }
      : {
          type: 'add_slide',
          ...(currentPlanItem.afterSlideId ? { afterSlideId: currentPlanItem.afterSlideId } : {}),
          setActive: true,
          reason: 'Criar o slide planejado antes de inserir o conteudo de fallback.',
          slide: {
            id: targetSlideId,
            title,
            ...slideStyle
          }
        },
    {
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Garantir que o slide planejado tenha titulo visivel.',
      element: {
        type: 'text',
        id: 'titulo-principal',
        content: title,
        x: 72,
        y: 56,
        width: 1136,
        height: 86,
        fontSize: 40,
        fontWeight: '700',
        textColor: text,
        animationType: 'fade-in',
        animationDuration: 0.6,
        zIndex: 2
      }
    },
    {
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Garantir conteudo legivel quando o provedor retornar apenas a estrutura do slide.',
      element: {
        type: 'text',
        id: 'subtitulo-principal',
        content: truncateText(subtitle, 180),
        x: 72,
        y: 142,
        width: 780,
        height: 92,
        fontSize: 24,
        fontWeight: '500',
        textColor: mutedText,
        textAlign: 'left',
        animationType: 'fade-in',
        animationDuration: 0.7,
        animationDelay: 0.1,
        zIndex: 2
      }
    },
    {
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Criar card principal com conteudo organizado.',
      element: {
        type: 'block',
        id: 'card-principal',
        content: truncateText(body, 260),
        x: 72,
        y: 272,
        width: 520,
        height: 260,
        fontSize: 24,
        fontWeight: '600',
        textColor: text,
        textAlign: 'left',
        backgroundColor: surface,
        solidColor: surface,
        animationType: 'fade-in',
        animationDuration: 0.7,
        animationDelay: 0.15,
        zIndex: 2
      }
    },
    {
      type: 'add_element',
      slideId: targetSlideId,
      reason: 'Adicionar faixa visual para dar acabamento profissional.',
      element: {
        type: 'block',
        id: 'faixa-visual',
        content: '',
        x: 704,
        y: 194,
        width: 430,
        height: 338,
        backgroundColor: surfaceAlt,
        solidColor: surfaceAlt,
        useGradient: true,
        gradientStart: surfaceAlt,
        gradientEnd: secondary,
        opacity: 0.92,
        zIndex: 1
      }
    }
  ];

  if (currentPlanItem.interactionType === 'drag-drop') {
    const pieceId = 'peca-arrastavel';
    return [
      ...baseActions,
      {
        type: 'add_element',
        slideId: targetSlideId,
        reason: 'Adicionar peca arrastavel para atividade de encaixe.',
        element: {
          id: pieceId,
          type: 'block',
          content: 'Arraste',
          x: 184,
          y: 558,
          width: 240,
          height: 84,
          fontSize: 24,
          fontWeight: '700',
          textAlign: 'center',
          textColor: '#ffffff',
          backgroundColor: primary,
          solidColor: primary,
          useGradient: true,
          gradientStart: primary,
          gradientEnd: accent,
          studentCanDrag: true,
          animationType: 'pulse',
          animationDuration: 1,
          animationLoop: true,
          zIndex: 4
        }
      },
      {
        type: 'add_element',
        slideId: targetSlideId,
        reason: 'Adicionar area visual de destino para arrastar e colar.',
        element: {
          id: 'area-de-encaixe',
          type: 'block',
          content: 'Solte aqui',
          x: 812,
          y: 384,
          width: 292,
          height: 164,
          fontSize: 24,
          fontWeight: '700',
          textAlign: 'center',
          textColor: primary,
          backgroundColor: surface,
          solidColor: surface,
          zIndex: 2
        }
      },
      {
        type: 'add_element',
        slideId: targetSlideId,
        reason: 'Adicionar detector invisivel funcional sobre a area de encaixe.',
        element: {
          id: 'detector-encaixe',
          type: 'detector',
          x: 812,
          y: 384,
          width: 292,
          height: 164,
          actionConfig: {
            type: 'addText',
            text: 'Muito bem! Voce encaixou a peca correta.',
            insertX: 800,
            insertY: 572,
            insertWidth: 340,
            insertHeight: 70,
            detectorAcceptedDrag: `element:${pieceId}`,
            detectorMinMatchCount: 1,
            detectorTriggerOnce: true,
            textColor: text,
            backgroundColor: surface
          },
          interactionTriggers: [
            {
              id: 'trigger-encaixe',
              name: 'Ao encaixar',
              enabled: true,
              actionConfig: {
                type: 'addText',
                text: 'Muito bem! Voce encaixou a peca correta.',
                insertX: 800,
                insertY: 572,
                insertWidth: 340,
                insertHeight: 70,
                detectorAcceptedDrag: `element:${pieceId}`,
                detectorMinMatchCount: 1,
                detectorTriggerOnce: true,
                textColor: text,
                backgroundColor: surface
              }
            }
          ],
          zIndex: 5
        }
      }
    ];
  }

  if (currentPlanItem.interactionType === 'quiz') {
    return [
      ...baseActions,
      {
        type: 'add_element',
        slideId: targetSlideId,
        reason: 'Adicionar quiz rapido para reforcar a aprendizagem.',
        element: {
          id: 'quiz-rapido',
          type: 'quiz',
          question: `Qual ideia principal deste slide?`,
          options: ['Identificar o conceito', 'Ignorar a atividade', 'Pular a etapa'],
          correctOption: 0,
          successMessage: 'Correto!',
          errorMessage: 'Revise o card principal e tente novamente.',
          actionLabel: 'Validar resposta',
          points: 1,
          lockOnWrong: false,
          quizBackgroundColor: surface,
          quizQuestionColor: text,
          quizOptionBackgroundColor: surfaceAlt,
          quizOptionTextColor: text,
          quizButtonBackgroundColor: primary,
          x: 704,
          y: 288,
          width: 456,
          height: 330,
          zIndex: 3
        }
      }
    ];
  }

  if (currentPlanItem.interactionType === 'timed-challenge') {
    const hiddenId = 'pista-temporizada';
    return [
      ...baseActions,
      {
        type: 'add_element',
        slideId: targetSlideId,
        reason: 'Adicionar pista oculta para revelar por tempo.',
        element: {
          id: hiddenId,
          type: 'block',
          content: 'Pista liberada: observe o card principal e conecte a ideia ao desafio.',
          x: 704,
          y: 558,
          width: 430,
          height: 92,
          fontSize: 22,
          fontWeight: '700',
          textColor: text,
          textAlign: 'center',
          backgroundColor: surface,
          solidColor: surface,
          initiallyHidden: true,
          animationType: 'zoom-in',
          animationDuration: 0.5,
          zIndex: 4
        }
      },
      {
        type: 'add_element',
        slideId: targetSlideId,
        reason: 'Adicionar gatilho por tempo para revelar a pista.',
        element: {
          id: 'gatilho-tempo',
          type: 'timedTrigger',
          x: 1038,
          y: 56,
          width: 110,
          height: 56,
          actionConfig: {
            type: 'showElement',
            targetElementId: hiddenId
          },
          interactionTriggers: [
            {
              id: 'trigger-tempo',
              name: 'Revelar pista',
              enabled: true,
              time: 5,
              actionConfig: {
                type: 'showElement',
                targetElementId: hiddenId
              }
            }
          ],
          zIndex: 5
        }
      }
    ];
  }

  return baseActions;
}

function normalizePlanItemActions(actions, currentPlanItem, existingSlides = []) {
  if (!currentPlanItem || !Array.isArray(actions) || !actions.length) {
    return actions;
  }
  const normalizedTitle = String(currentPlanItem.title || '').trim().toLowerCase();
  const requestedTargetId = String(currentPlanItem.targetSlideId || currentPlanItem.id || '').trim();
  const existingMatch = existingSlides.find((slide) =>
    String(slide?.id || '').trim() === requestedTargetId
      || (!requestedTargetId && normalizedTitle && String(slide?.title || '').trim().toLowerCase() === normalizedTitle)
  );
  const targetSlideId = requestedTargetId || existingMatch?.id || createSafeId('slide-ai', currentPlanItem.title, currentPlanItem.order || 0);
  const slideStyle = currentPlanItem.slideStyle || getThemeSlideStyle(currentPlanItem.visualTheme, Math.max(0, Number(currentPlanItem.order || 1) - 1));
  let hasTargetSlideCreation = false;
  let hasSlideUpdate = false;

  const rewritten = [];
  for (const rawAction of actions) {
    const action = JSON.parse(JSON.stringify(rawAction));
    if (action.type === 'add_slide') {
      if (existingMatch) {
        if (!hasSlideUpdate) {
          rewritten.push({
            type: 'update_slide',
            reason: action.reason || `Preparar o slide planejado: ${currentPlanItem.title || 'Slide'}.`,
            slideId: existingMatch.id,
            setActive: true,
            slide: {
              ...(action.slide || {}),
              id: undefined,
              title: currentPlanItem.title || action.slide?.title || existingMatch.title || 'Slide'
            }
          });
          delete rewritten.at(-1).slide.id;
          hasSlideUpdate = true;
        }
      } else if (!hasTargetSlideCreation) {
        action.slide = {
          ...slideStyle,
          ...(action.slide || {}),
          id: targetSlideId,
          title: currentPlanItem.title || action.slide?.title || 'Slide'
        };
        action.afterSlideId = currentPlanItem.afterSlideId || action.afterSlideId;
        action.setActive = true;
        hasTargetSlideCreation = true;
        rewritten.push(action);
      }
      continue;
    }
    if (action.type === 'update_slide') {
      action.slideId = targetSlideId;
      if (action.slide) {
        delete action.slide.id;
        action.slide = {
          ...action.slide,
          title: currentPlanItem.title || action.slide.title
        };
      }
      hasSlideUpdate = true;
      rewritten.push(action);
      continue;
    }
    if (action.type === 'delete_slide') {
      continue;
    }
    if (action.slideId || action.type === 'add_element' || action.type === 'update_element' || action.type === 'delete_element' || action.type === 'select_element') {
      action.slideId = targetSlideId;
    }
    rewritten.push(action);
  }

  if (!existingMatch && !hasTargetSlideCreation) {
    rewritten.unshift({
      type: 'add_slide',
      reason: `Criar o slide planejado: ${currentPlanItem.title || 'Slide'}.`,
      ...(currentPlanItem.afterSlideId ? { afterSlideId: currentPlanItem.afterSlideId } : {}),
      slide: {
        ...slideStyle,
        id: targetSlideId,
        title: currentPlanItem.title || 'Slide',
        backgroundColor: slideStyle.backgroundColor || '#fdfbff'
      },
      setActive: true
    });
  }

  return rewritten;
}

function postProcessActions(actions, request, existingSlides = [], options = {}) {
  const disableStoryExpansion = options?.disableStoryExpansion === true || requestExplicitlyForbidsNewSlides(request);
  const currentPlanItem = options?.currentPlanItem || null;
  let nextActions = currentPlanItem
    ? normalizePlanItemActions(actions, currentPlanItem, existingSlides)
    : actions;
  nextActions = ensureSlideIds(nextActions, existingSlides);
  nextActions = reuseInitialBlankSlide(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  if (!disableStoryExpansion) {
    nextActions = ensureMinimumStorySlides(nextActions, request, existingSlides);
  }
  nextActions = ensureSlideIds(nextActions, existingSlides);
  nextActions = reuseInitialBlankSlide(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  if (!disableStoryExpansion) {
    nextActions = ensureRequestedSlideCount(nextActions, request, existingSlides);
  }
  nextActions = ensureSlideIds(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  if (!disableStoryExpansion) {
    nextActions = ensureMinimumButtonActions(nextActions, request, existingSlides);
  }
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  nextActions = repairButtonActions(nextActions, existingSlides);
  nextActions = sanitizePlannerInstructionLeaks(nextActions, currentPlanItem);
  nextActions = normalizeMoveElementDirections(nextActions, existingSlides);
  nextActions = coercePlatformElementStyles(nextActions);
  nextActions = applyImagePolicyToActions(nextActions, request, currentPlanItem);
  nextActions = ensureRequiredImageGeneration(nextActions, request, currentPlanItem, options?.stageSize || DEFAULT_STAGE_SIZE);
  nextActions = applyDeckVisualThemeToActions(nextActions, request, currentPlanItem, options?.executionPlan || null);
  nextActions = sanitizePlannerInstructionLeaks(nextActions, currentPlanItem);
  nextActions = sanitizeActionTextFit(nextActions, options?.stageSize || DEFAULT_STAGE_SIZE);
  nextActions = ensureElementIds(nextActions, existingSlides);
  nextActions = repairDragDropDetectorConfiguration(nextActions, existingSlides, currentPlanItem);
  nextActions = addSupportCardsForReadableContent(nextActions, currentPlanItem);
  nextActions = ensureNarrativeForLonelyBulletMarkers(nextActions, currentPlanItem);
  nextActions = constrainActionGeometry(nextActions, options?.stageSize || DEFAULT_STAGE_SIZE);
  nextActions = resolveActionLayoutCollisions(nextActions, existingSlides, options?.stageSize || DEFAULT_STAGE_SIZE);
  nextActions = repairEmptySupportBlockStacking(nextActions);
  nextActions = repairRemainingLayoutConflicts(nextActions, existingSlides);
  nextActions = ensureImageSpacePlaceholder(nextActions, request, currentPlanItem, options?.stageSize || DEFAULT_STAGE_SIZE);
  return nextActions;
}

function needsRetry(actions, request, existingSlides = [], options = {}) {
  if (options?.disableStoryExpansion === true || requestExplicitlyForbidsNewSlides(request)) {
    return !Array.isArray(actions)
      || !actions.length
      || !planItemHasRenderableContent(actions, options?.currentPlanItem, existingSlides);
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
    visualTheme: executionPlan.visualTheme || currentPlanItem?.visualTheme || null,
    currentPlanItem: currentPlanItem
      ? {
        id: currentPlanItem.id || '',
        title: truncateText(currentPlanItem.title || '', 80),
        goal: truncateText(currentPlanItem.goal || '', 180),
        layoutNotes: truncateText(currentPlanItem.layoutNotes || '', 180),
        interactionNotes: truncateText(currentPlanItem.interactionNotes || '', 180),
        interactionType: currentPlanItem.interactionType || 'content',
        imageIntent: currentPlanItem.imageIntent || 'optional',
        visualTheme: currentPlanItem.visualTheme || executionPlan.visualTheme || null,
        slideStyle: currentPlanItem.slideStyle || null,
        order: currentPlanItem.order || null,
        targetSlideId: currentPlanItem.targetSlideId || null,
        afterSlideId: currentPlanItem.afterSlideId || null
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
  executionPlan = null,
  currentPlanItem = null
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  const wantsGeneratedImage = requestExplicitlyAsksForGeneratedImage(request);
  const imagePolicy = currentPlanItem?.imageIntent || inferRequestedImagePolicy(request);
  const dynamicRules = [];
  if (executionPlan?.mode === 'simple') {
    dynamicRules.push('Faca apenas o pedido simples solicitado. Nao crie novos slides.');
  }
  if (executionPlan?.mode === 'deck' && currentPlanItem) {
    const promptTheme = currentPlanItem.visualTheme || executionPlan.visualTheme || null;
    dynamicRules.push(
      `Monte somente o slide atual usando exatamente targetSlideId=${currentPlanItem.targetSlideId || currentPlanItem.id}.`,
      'O sistema ja reservou esse ID. Nao invente, nao altere e nao reutilize outro slideId.',
      'Entregue o slide completo nesta resposta: estrutura de slide e todos os elementos necessarios para ele nao ficar vazio.',
      'goal, layoutNotes e interactionNotes sao briefing interno. Nunca copie esses textos literalmente para content, label, question ou options.',
      'Transforme objetivos em conteudo final de aula. Exemplo: se o goal for "Definir o escambo como pratica de troca", o slide deve dizer "O escambo era uma troca direta de produtos e servicos, sem dinheiro".',
      'Nao escreva instrucoes no palco, como "Definir...", "Explicar...", "Apresentar...", "Reserve area...", "Crie uma imagem..." ou nomes de ferramentas. Execute a instrucao criando texto final, imagem, quiz ou gatilho.',
      'Crie um layout proprio, bonito e moderno para este slide, sem depender de template base.',
      'Use hierarquia profissional: titulo curto, conteudo escaneavel, respiro, alinhamento consistente e composicao visual clara.',
      'Um slide de conteudo normalmente precisa de 3 a 8 elementos bem organizados. Use mais apenas quando a interacao realmente exigir.',
      'Nao retorne apenas add_slide. Inclua pelo menos um elemento visual ou textual renderizavel no slide.',
      `Use a mesma paleta do deck inteiro: ${JSON.stringify(promptTheme?.palette || {})}. Nao use cores aleatorias fora dessa paleta.`,
      `Aplique este fundo no slide atual quando nao houver imagem de fundo: ${JSON.stringify(currentPlanItem.slideStyle || {})}.`,
      `Mantenha margem minima de ${LAYOUT_SAFE_MARGIN}px nas bordas e ${LAYOUT_ELEMENT_GAP}px entre elementos principais.`,
      'Antes de posicionar texto, calcule a caixa dos blocos, imagens, quiz e botoes. Texto nao pode ficar escondido atras ou abaixo de outro elemento.',
      'Distribua o palco em zonas antes de criar elementos: cabecalho, conteudo principal, area visual/interativa e rodape quando necessario.',
      'Se o texto nao couber, reduza o texto, reduza fontSize ou aumente a caixa dentro do palco. Nunca sobreponha texto para caber.',
      'Trabalhe em duas etapas internas: primeiro decida o layout e as caixas do slide; depois configure gatilhos, detector, quiz, botoes e alvos usando esses elementos ja posicionados.',
      'Nao crie slide estatico quando o plano pedir aula interativa. Use a ferramenta real mais adequada: quiz, detector, floatingButton, timedTrigger, key, input, videoTriggers ou animacao.',
      'Se criar algo para revelar depois, o elemento alvo deve ter initiallyHidden true e o gatilho deve usar showElement ou hideElement de verdade.',
      'Se criar imagem gerada, use type image com generationPrompt detalhado. Nao use block como placeholder de imagem.'
    );
    if (currentPlanItem.interactionType === 'drag-drop') {
      dynamicRules.push(
        'Este slide deve ser gamificado em arrastar e colar: crie uma peca com studentCanDrag true, uma area visual de destino e um detector invisivel funcional sobre a area.',
        'O detector precisa aceitar explicitamente a peca arrastavel via detectorAcceptedDrag element:id-da-peca e precisa ter interactionTriggers/actionConfig com resultado visivel.',
        'Se houver um bloco ou card com texto como "Solte aqui", "Destino" ou equivalente, o detector deve ficar exatamente em cima desse elemento visual, com o mesmo x, y, width e height.',
        'Se o detector usar showElement, escolha explicitamente qual elemento oculto sera mostrado via targetElementId. Nao deixe showElement sem alvo.'
      );
    } else if (currentPlanItem.interactionType === 'quiz') {
      dynamicRules.push('Este slide deve ter quiz funcional completo, com opcoes, resposta correta, mensagens, pontos e cores da paleta.');
    } else if (currentPlanItem.interactionType === 'timed-challenge') {
      dynamicRules.push('Este slide deve ter gatilho por tempo funcional ou animacao temporizada, com interactionTriggers contendo time e actionConfig real.');
    }
  }
  if (imagePolicy === 'none') {
    dynamicRules.push(
      'Nao crie image, backgroundImage nem generationPrompt neste slide. O professor pediu sem imagens.',
      'Se o pedido mencionar espaco, area ou local de imagem sem gerar imagem, use block neutro como placeholder visual e nunca dispare a IA de imagem.'
    );
  } else if (imagePolicy === 'required') {
    dynamicRules.push('Este slide precisa de uma imagem gerada. Inclua image com generationPrompt detalhado e reserve uma area real do layout para ela.');
  } else if (imagePolicy === 'optional') {
    dynamicRules.push('Imagem e opcional neste slide. Use somente se melhorar a explicacao sem apertar o conteudo.');
  }
  if (wantsGeneratedImage) {
    dynamicRules.push(
      'O pedido exige uma imagem nova gerada por IA.',
      'Sua resposta deve incluir um elemento do tipo image com generationPrompt detalhado, ou backgroundImagePrompt se o pedido for claramente um fundo.',
      'Nao resolva esse pedido apenas com bloco, texto, placeholder ou layout sem imagem gerada.'
    );
  }
  const capabilities = createAiCapabilityCatalog();
  const payload = {
    role: 'slide_builder_agent',
    objective: 'Generate actions to modify slide deck based on user request.',
    constraints: [
        'Output MUST be a valid JSON array of actions.',
        'Strictly follow the action schemas provided.',
        'Respect stage bounds (1280x720).',
        'When userRequest names a specific object or element, that textual request defines the final identity. Use attachmentSummary mainly for position, size, silhouette and orientation, not to rename the object.',
        'Never render planning instructions as slide text. Internal fields such as goal, layoutNotes and interactionNotes must be converted into final student-facing lesson content.',
        ...ELEMENT_CONFIGURATION_RULES,
        ...dynamicRules
    ],
    context: {
      currentSlides: orderedSlides,
      activeSlideId: activeSlideId || null,
      userRequest: truncateText(request, MAX_REQUEST_LENGTH),
      attachmentSummary: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      explicitImageRequest: wantsGeneratedImage,
      imagePolicy,
      targetSlideContract: currentPlanItem
        ? {
          targetSlideId: currentPlanItem.targetSlideId || currentPlanItem.id,
          afterSlideId: currentPlanItem.afterSlideId || null,
          title: currentPlanItem.title || '',
          goal: currentPlanItem.goal || '',
          layoutNotes: currentPlanItem.layoutNotes || '',
          interactionNotes: currentPlanItem.interactionNotes || '',
          interactionType: currentPlanItem.interactionType || 'content',
          visualTheme: currentPlanItem.visualTheme || executionPlan?.visualTheme || null,
          slideStyle: currentPlanItem.slideStyle || null
        }
        : null,
      layoutMode: 'freeform_modern_layout'
    },
    capabilities,
    executionPlan: summarizePromptPlanContext(executionPlan, currentPlanItem)
  };
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
      visualTheme: executionPlan.visualTheme || null,
      simpleTask: executionPlan.simpleTask
        ? {
          title: truncateText(executionPlan.simpleTask.title || '', 120),
          goal: truncateText(executionPlan.simpleTask.goal || '', 220),
          deliverable: truncateText(executionPlan.simpleTask.deliverable || '', 120),
          imageIntent: executionPlan.simpleTask.imageIntent || 'optional',
          targetSlideId: executionPlan.simpleTask.targetSlideId || null
        }
        : null
    };
  }
  return {
    mode: executionPlan.mode || 'deck',
    summary: truncateText(executionPlan.summary || '', 240),
    visualTheme: executionPlan.visualTheme || null,
    slides: Array.isArray(executionPlan.slides)
      ? executionPlan.slides.slice(0, MAX_PLAN_SLIDES).map((item, index) => ({
        id: item?.id || `slide-plan-${index + 1}`,
        title: truncateText(item?.title || `Slide ${index + 1}`, 80),
        goal: truncateText(item?.goal || '', 160),
        targetSlideId: item?.targetSlideId || null,
        afterSlideId: item?.afterSlideId || null,
        interactionType: item?.interactionType || 'content',
        imageIntent: item?.imageIntent || 'optional'
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
      'Evite alterar slides fora do item atual, exceto quando um botao deste slide precisar apontar para um proximo slide ja planejado.',
      `Use somente a paleta do deck: ${JSON.stringify((currentPlanItem.visualTheme || executionPlan.visualTheme || {})?.palette || {})}.`,
      `Use este estilo de fundo no slide atual quando criar/atualizar o slide: ${JSON.stringify(currentPlanItem.slideStyle || {})}.`,
      `Mantenha margem minima de ${LAYOUT_SAFE_MARGIN}px nas bordas e ${LAYOUT_ELEMENT_GAP}px de respiro entre elementos.`,
      'Calcule a caixa de cada elemento antes de posicionar o proximo; texto nao pode ficar embaixo de bloco, imagem, quiz ou botao.',
      'Prefira colocar textos, imagens e quizzes importantes dentro de cards ou blocos de apoio quando isso melhorar a leitura.'
    );
    if (currentPlanItem.interactionType === 'drag-drop') {
      contextualInstructions.push(
        'Este item do plano exige arrastar e colar: crie peca studentCanDrag true, area visual de destino e detector invisivel funcional no destino.',
        'O detector deve ter detectorAcceptedDrag apontando para a peca e interactionTriggers/actionConfig com resultado visivel.'
      );
    } else if (currentPlanItem.interactionType === 'quiz') {
      contextualInstructions.push('Este item do plano exige quiz funcional completo, nao apenas texto com pergunta.');
    } else if (currentPlanItem.interactionType === 'timed-challenge') {
      contextualInstructions.push('Este item do plano exige gatilho por tempo/animacao temporizada com time e actionConfig reais.');
    }
  }
  if (wantsGeneratedImage) {
    contextualInstructions.push(
      'O pedido exige uma imagem nova gerada por IA.',
      'Sua proxima acao deve criar ou atualizar um elemento do tipo image com generationPrompt detalhado, ou usar backgroundImagePrompt se o pedido for explicitamente um fundo.',
      'Nao resolva esse pedido so com bloco, texto, placeholder ou layout sem imagem.'
    );
  }
  if ((currentPlanItem?.imageIntent || inferRequestedImagePolicy(request)) === 'none') {
    contextualInstructions.push(
      'Neste slide, nao gere imagens por IA.',
      'Se o pedido pedir apenas reservar espaco de imagem, use um block placeholder com texto curto como "Espaco da imagem".'
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
      'Se houver marcadores, pontos visuais ou bullets, cada um precisa ter texto real associado. Nunca deixe apenas bolinhas decorativas sem conteudo.',
      'Cheque se textos realmente cabem no box escolhido. Se a fonte estiver grande demais para width e height, ajuste antes de responder.',
      'Pense em duas fases internas: 1) layout e zonas do palco; 2) configuracao de gatilhos e elementos funcionais apontando para IDs reais do proprio slide.',
      'Use contraste forte entre fundo, blocos e texto.',
      'Use paleta harmonica e coerente entre fundo, blocos e botoes.',
      'Use animacoes simples quando fizer sentido: fade-in, slide-left, zoom-in, pulse, float ou none.',
      'Quando o pedido pedir animacao, responda com os campos de animacao ja configurados no proprio elemento. Nao diga apenas que o elemento sera animado.',
      'Quando o pedido pedir que um botao faca algo, configure o actionConfig completo para essa acao. Nao deixe o botao sem comportamento real.',
      'Quando o pedido pedir detector, arraste, encaixe ou colisao, configure o detector de forma funcional, com detectorAcceptedDrag, detectorMinMatchCount ou detectorTriggerOnce quando necessario.',
      'Se existir uma area visual de destino com texto como "Solte aqui" ou "Destino", use essa mesma area como referencia geometrica do detector: x, y, width e height devem coincidir.',
      'Se o detector revelar feedback, use showElement com targetElementId apontando para um elemento real e inicialmenteHidden true.',
      'Quando o pedido pedir quiz, responda com o quiz completo e configurado, com mensagens, opcoes, resposta correta e botao interno prontos.',
      'Se o pedido pedir interatividade, prefira floatingButton, quiz ou detector com comportamento funcional.',
      'Nunca crie floatingButton vazio. Se houver botao, ele precisa ter actionConfig util para navegar, revelar conteudo, abrir quiz, mover elemento ou tocar animacao.',
      'Se usar moveElement, lembre: moveByX positivo move para a direita, moveByX negativo move para a esquerda, moveByY positivo move para baixo e moveByY negativo move para cima.',
      'Exemplo obrigatorio de referencia: esquerda = moveByX: -160, direita = moveByX: 160, cima = moveByY: -80, baixo = moveByY: 80.',
      'Nao adicione floatingButton para validar quiz comum, porque o proprio quiz ja possui botao interno.',
      'Se usar detector, lembre que ele e invisivel para o aluno. Adicione um elemento visual de apoio quando a area precisar ser percebida.',
      'Use os recursos da plataforma de forma intencional: block para estrutura, text para conteudo, image para ilustracao, floatingButton para acao, quiz para avaliacao e detector para gatilhos invisiveis.',
      'Quando a imagem ajudar a explicar melhor, prefira incluir image com generationPrompt ou fundo com backgroundImagePrompt, exceto quando o pedido proibir gerar imagens.',
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
      visualTheme: currentPlanItem?.visualTheme || executionPlan?.visualTheme || null,
      slideStyle: currentPlanItem?.slideStyle || null,
      layoutMode: 'freeform_modern_layout',
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
  attachmentInsights = ''
}) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  const requestedSlideCount = extractRequestedSlideCount(request);
  const wantsGeneratedImage = requestExplicitlyAsksForGeneratedImage(request);
  const imagePolicy = inferRequestedImagePolicy(request);
  const suggestedVisualTheme = summarizeVisualThemeForPrompt(inferDeckVisualTheme(request));
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
      'Planeje cada slide para ser criado pela IA com layout proprio, bonito, moderno e dentro do palco.',
      'Se o pedido for gamificado, planeje mecanicas reais com drag-drop, detector, pontos, fases, quiz ou desafio por tempo quando fizer sentido.',
      'Se for aula interativa/guiada, planeje progressao didatica com blocos curtos, imagens, quiz, botoes, revelacoes e interacoes sem poluir o slide.',
      'Em mode deck, cada item de slides deve ter title, goal, layoutNotes, interactionNotes, interactionType e imageIntent.',
      'interactionType deve ser content, mission-content, drag-drop, quiz ou timed-challenge. Use drag-drop quando o pedido pedir arrastar, colar, encaixar ou jogo de associacao. Use quiz para checagem. Use timed-challenge para revelar pista por tempo.',
      'imageIntent deve ser none, optional ou required. Respeite imagePolicy: none proibe imagens; sparse usa no maximo duas imagens no deck; rich favorece imagens na maioria dos slides; balanced deve ter imagens em alguns slides-chave.',
      'Use uma identidade visual unica para o deck inteiro. Voce pode sugerir visualTheme com palette, mas o sistema tambem aplicara uma paleta consistente depois.',
      `Em layoutNotes, descreva as zonas do slide usando caixas e margens: titulo, conteudo, area de imagem/interacao e rodape. Reserve no minimo ${LAYOUT_SAFE_MARGIN}px das bordas e ${LAYOUT_ELEMENT_GAP}px entre areas.`,
      'layoutNotes deve orientar uma composicao final, nao instrucoes para aparecer no palco.',
      'Nao planeje rascunhos. Cada slide precisa ter conteudo, fundo e composicao finalizavel no passo dele.',
      'Em deck com 5+ slides, planeje variedade real: ao menos um slide com imagem gerada, um quiz, um reveal/tempo e, se fizer sentido, um drag-drop.',
      'Em interactionNotes, cite os elementos da plataforma que devem existir: image, quiz, detector, floatingButton, timedTrigger, key, input ou videoTriggers.',
      'Nao crie IDs tecnicos. O sistema reservara IDs unicos depois que o plano estiver pronto.',
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
      'Se o pedido pedir aula gamificada, distribua interacoes em alguns slides: por exemplo drag-drop para associar conceitos, quiz para checagem e timed-challenge para revelar pista.',
      'Se attachmentInsights mencionar seta, direcao ou orientacao do rabisco, preserve isso explicitamente no plano do item atual.',
      'Nao inclua campos desnecessarios, comentarios ou texto fora do JSON.'
    ],
    context: {
      requestedSlideCount,
      explicitImageRequest: wantsGeneratedImage,
      imagePolicy,
      suggestedVisualTheme,
      gamifiedRequest: requestSuggestsGamifiedSlides(request),
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      layoutMode: 'freeform_modern_layout',
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  });
}

function createAiReviewPrompt({ request, slides, activeSlideId, stageSize, attachments = [], attachmentInsights = '' }) {
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
      'Se ainda houver um ajuste importante, retorne um unico objeto JSON no formato {"done": false, "action": {...}, "message": "..."}',
      'Se o resultado estiver bom, retorne {"done": true, "message": "..."}',
      'Proponha no maximo uma acao corretiva.',
      'Nao use markdown nem texto fora do JSON.'
    ],
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      layoutMode: 'freeform_modern_layout',
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
        backgroundColor: action.slide?.backgroundColor || '#fdfbff',
        backgroundFillType: action.slide?.backgroundFillType || 'solid',
        backgroundGradientStart: action.slide?.backgroundGradientStart || action.slide?.backgroundColor || '#fdfbff',
        backgroundGradientEnd: action.slide?.backgroundGradientEnd || '#dfe7ff'
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
          backgroundColor: action.slide.backgroundColor || '#fdfbff',
          backgroundFillType: action.slide.backgroundFillType || 'solid',
          backgroundGradientStart: action.slide.backgroundGradientStart || action.slide.backgroundColor || '#fdfbff',
          backgroundGradientEnd: action.slide.backgroundGradientEnd || '#dfe7ff'
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

async function callGoogleGenerateContent({ settings, parts, responseModalities = null }) {
  const apiKey = decryptApiKey(settings.image_encrypted_api_key || settings.encrypted_api_key);
  const baseUrl = String(settings.image_base_url || settings.base_url || DEFAULT_IMAGE_PROVIDER.baseUrl).replace(/\/+$/, '');
  const model = String(settings.image_model || settings.model || DEFAULT_IMAGE_PROVIDER.model).trim();
  const bodyPayload = {
    contents: [
      {
        parts
      }
    ]
  };
  if (Array.isArray(responseModalities) && responseModalities.length) {
    bodyPayload.generationConfig = { responseModalities };
  }
  const response = await safeFetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': apiKey
    },
    body: JSON.stringify(bodyPayload)
  }, { allowHttp: allowHttpProviderUrls, timeoutMs: 60000 });
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
    parts,
    responseModalities: ['TEXT', 'IMAGE']
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
    parts,
    responseModalities: ['TEXT', 'IMAGE']
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

function actionListNeedsNanoBanana(actions = []) {
  return actions.some((action) => (
    Boolean(action?.slide?.backgroundImagePrompt) ||
    Boolean(action?.element?.type === 'image' && action.element.generationPrompt && !action.element.src) ||
    Boolean(action?.element?.actionConfig?.type === 'addImage' && action.element.actionConfig.generationPrompt && !action.element.actionConfig.url)
  ));
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

async function editImageElementWithNanoBanana({
  settingsRow,
  request,
  attachments = [],
  sourceBounds = null,
  stageSize = null
}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const resolvedStageSize = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const normalizedBounds = normalizeMagicPenSourceBounds(sourceBounds, resolvedStageSize);
  const attachmentInsights = await describeAttachmentsWithNanoBanana({
    imageSettings: settingsRow,
    attachments: normalizedAttachments,
    request
  });
  return generateImageWithNanoBanana({
    imageSettings: settingsRow,
    prompt: buildMagicPenImagePrompt({
      request,
      attachmentInsights,
      sourceBounds: normalizedBounds,
      stageSize: resolvedStageSize
    }),
    attachments: normalizedAttachments
  });
}

async function enrichActionsWithGeneratedImages(actions, settingsRow, attachments = [], context = {}) {
  if (context?.imagePolicy === 'none') {
    return applyImagePolicyToActions(actions, context?.request || '', context?.currentPlanItem || { imageIntent: 'none' });
  }
  const normalizedAttachments = normalizeImageAttachments(attachments);
  if (!settingsRow?.image_encrypted_api_key || settingsRow?.image_is_enabled === false) {
    if (actionListNeedsNanoBanana(actions)) {
      throw new Error('A Nano Banana precisa estar configurada e ativa para gerar as imagens solicitadas pela IA.');
    }
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
  const response = await safeFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: getEffectiveChatModel(settings),
      messages: preparedMessages,
      temperature,
      stream: false
    })
  }, { allowHttp: allowHttpProviderUrls, timeoutMs: 60000 });
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

function normalizePlanImageIntent(value, imagePolicy, index, totalSlides, interactionType = 'content') {
  if (imagePolicy === 'none') return 'none';
  if (imagePolicy === 'rich') {
    if (index === 0) return 'required';
    if (totalSlides <= 3) return 'required';
    if (['drag-drop', 'quiz', 'timed-challenge'].includes(interactionType) && index % 3 !== 0) {
      return 'optional';
    }
    return index % 2 === 0 || interactionType === 'mission-content' ? 'required' : 'optional';
  }
  if (imagePolicy === 'required') return 'required';
  if (imagePolicy === 'sparse') {
    const sparseIndexes = new Set([0]);
    if (totalSlides >= 8) sparseIndexes.add(Math.floor(totalSlides / 2));
    return sparseIndexes.has(index) ? 'required' : 'none';
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (['none', 'optional', 'required'].includes(normalized)) {
    return normalized;
  }
  const visualIndexes = new Set([0]);
  if (totalSlides >= 5) visualIndexes.add(2);
  if (totalSlides >= 8) visualIndexes.add(Math.floor(totalSlides / 2));
  if (totalSlides >= 11) visualIndexes.add(totalSlides - 2);
  if (['drag-drop', 'quiz', 'timed-challenge'].includes(interactionType) && index !== 0) {
    return 'optional';
  }
  return visualIndexes.has(index) ? 'required' : 'optional';
}

function normalizeExecutionPlan(planPayload, request, existingSlides = [], activeSlideId = null) {
  const requestedSlideCount = extractRequestedSlideCount(request);
  const imagePolicy = inferRequestedImagePolicy(request);
  const visualTheme = summarizeVisualThemeForPrompt(inferDeckVisualTheme(request, planPayload));
  const normalizedSummary = truncateText(planPayload?.summary || request || '', 280);
  const initialTargetSlideId = activeSlideId || existingSlides[0]?.id || null;
  const shouldPreferSimple =
    requestExplicitlyForbidsNewSlides(request) ||
    ((!requestedSlideCount || requestedSlideCount <= 1) && !requestSuggestsStoryFlow(request) && !requestSuggestsEducationalDeck(request));

  if (shouldPreferSimple) {
    const simpleTask = planPayload?.simpleTask && typeof planPayload.simpleTask === 'object' ? planPayload.simpleTask : {};
    return {
      mode: 'simple',
      summary: normalizedSummary,
      visualTheme,
      simpleTask: {
        id: 'simple-task',
        title: truncateText(simpleTask.title || 'Pedido simples', 80),
        goal: truncateText(simpleTask.goal || request || 'Entregar somente o que foi pedido.', 220),
        deliverable: truncateText(simpleTask.deliverable || 'single_change', 80),
        imageIntent: imagePolicy === 'none' ? 'none' : requestExplicitlyAsksForGeneratedImage(request) ? 'required' : 'optional',
        targetSlideId: typeof simpleTask.targetSlideId === 'string' && simpleTask.targetSlideId.trim()
          ? simpleTask.targetSlideId.trim()
          : initialTargetSlideId
      }
    };
  }

  const rawSlides = Array.isArray(planPayload?.slides) ? planPayload.slides : [];
  const inferredDefaultDeckCount = requestSuggestsEducationalDeck(request)
    ? requestSuggestsGamifiedSlides(request) ? 3 : 5
    : 1;
  const fallbackCount = Math.min(
    MAX_PLAN_SLIDES,
    requestedSlideCount || Math.max(inferredDefaultDeckCount, rawSlides.filter((entry) => entry && typeof entry === 'object').length || 1)
  );
  const sourceSlides = rawSlides.filter((entry) => entry && typeof entry === 'object').slice(0, fallbackCount);
  while (sourceSlides.length < fallbackCount) {
    sourceSlides.push({});
  }
  const usedSlideIds = new Set(existingSlides.map((slide) => slide?.id).filter(Boolean));
  const reuseFirstSlide = isBlankInitialSlide(existingSlides);
  const normalizedSlides = sourceSlides.map((entry, index) => {
      const title = truncateText(entry.title || getDefaultRequestedSlideTitle(index), 80) || `Slide ${index + 1}`;
      const reservedId = allocateUniqueId(usedSlideIds, 'slide-ai', `${String(index + 1).padStart(2, '0')}-${title}`, index);
      const targetSlideId = index === 0 && reuseFirstSlide ? initialTargetSlideId : reservedId;
      const slideStyle = getThemeSlideStyle(visualTheme, index);
      const interactionType = inferPlanItemInteractionType(entry, request, index, fallbackCount);
      return {
        id: reservedId,
        title,
        goal: truncateText(entry.goal || entry.objective || request || `Desenvolver o slide ${index + 1}.`, 220),
        layoutNotes: truncateText(entry.layoutNotes || entry.layout || '', 220),
        interactionNotes: truncateText(entry.interactionNotes || entry.interaction || '', 220),
        interactionType,
        imageIntent: normalizePlanImageIntent(entry.imageIntent, imagePolicy, index, fallbackCount, interactionType),
        visualTheme,
        slideStyle,
        order: index + 1,
        targetSlideId,
        afterSlideId: null
      };
    });

  normalizedSlides.forEach((item, index) => {
    item.afterSlideId = index > 0
      ? normalizedSlides[index - 1].targetSlideId
      : reuseFirstSlide
        ? null
        : existingSlides.at(-1)?.id || null;
  });

  return {
    mode: 'deck',
    summary: normalizedSummary,
    imagePolicy,
    visualTheme,
    slides: normalizedSlides
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
          attachmentInsights
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
  currentPlanItem = null
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
      currentPlanItem
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
    executionPlan,
    currentPlanItem
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
    currentPlanItem,
    stageSize,
    executionPlan
  });
  let qualityIssues = collectActionQualityIssues(actions, slides, stageSize || DEFAULT_STAGE_SIZE, currentPlanItem);
  if (qualityIssues.length) {
    baseMessages.push({
      role: 'user',
      content: buildQualityRetryInstruction(qualityIssues)
    });
  }

  if (needsRetry(actions, request, slides, { disableStoryExpansion, currentPlanItem }) || qualityIssues.length) {
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
            'Sua resposta anterior nao atendeu completamente. Refaça em JSON valido. Se estiver montando um item do plano, use exatamente o targetSlideId reservado e entregue o slide com conteudo renderizavel, nunca apenas add_slide. Configure floatingButton, quiz, detector, gatilhos e animacoes por completo quando forem pedidos.'
        }
      ]
    });
    const retryParsed = await parseActionsFromModelContent(settingsRow, baseMessages, retryContent);
    actions = postProcessActions(normalizeActionList(retryParsed), request, slides, {
      disableStoryExpansion,
      currentPlanItem,
      stageSize,
      executionPlan
    });
  }

  actions = ensurePlanItemHasRenderableContent(actions, currentPlanItem, slides);
  actions = sanitizePlannerInstructionLeaks(actions, currentPlanItem);
  actions = applyImagePolicyToActions(actions, request, currentPlanItem);
  actions = sanitizeActionTextFit(actions, stageSize || DEFAULT_STAGE_SIZE);
  actions = constrainActionGeometry(actions, stageSize || DEFAULT_STAGE_SIZE);
  actions = resolveActionLayoutCollisions(actions, slides, stageSize || DEFAULT_STAGE_SIZE);
  actions = repairEmptySupportBlockStacking(actions);
  actions = repairRemainingLayoutConflicts(actions, slides);
  actions = ensureImageSpacePlaceholder(actions, request, currentPlanItem, stageSize || DEFAULT_STAGE_SIZE);
  assertActionQuality(actions, slides, stageSize || DEFAULT_STAGE_SIZE, currentPlanItem);

  return enrichActionsWithGeneratedImages(actions, settingsRow, normalizedAttachments, {
    slides,
    activeSlideId,
    stageSize,
    request,
    currentPlanItem,
    imagePolicy: currentPlanItem?.imageIntent || inferRequestedImagePolicy(request)
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
      currentPlanItem: args?.currentPlanItem || null
    });
    if (!fallbackActions.length) {
      throw error;
    }
    let recoveredActions = ensurePlanItemHasRenderableContent(
      fallbackActions,
      args?.currentPlanItem || null,
      Array.isArray(args?.slides) ? args.slides : []
    );
    recoveredActions = sanitizePlannerInstructionLeaks(recoveredActions, args?.currentPlanItem || null);
    recoveredActions = sanitizeActionTextFit(recoveredActions, args?.stageSize || DEFAULT_STAGE_SIZE);
    recoveredActions = constrainActionGeometry(recoveredActions, args?.stageSize || DEFAULT_STAGE_SIZE);
    recoveredActions = resolveActionLayoutCollisions(
      recoveredActions,
      Array.isArray(args?.slides) ? args.slides : [],
      args?.stageSize || DEFAULT_STAGE_SIZE
    );
    recoveredActions = repairRemainingLayoutConflicts(recoveredActions, Array.isArray(args?.slides) ? args.slides : []);
    assertActionQuality(
      recoveredActions,
      Array.isArray(args?.slides) ? args.slides : [],
      args?.stageSize || DEFAULT_STAGE_SIZE,
      args?.currentPlanItem || null
    );
    return recoveredActions;
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
            attachmentInsights: resolvedAttachmentInsights
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
  let processed = postProcessActions([normalizedAction], request, slides, {
    disableStoryExpansion: Boolean(executionPlan?.mode === 'deck' && currentPlanItem),
    currentPlanItem,
    stageSize,
    executionPlan
  });
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
    processed = postProcessActions([normalizeSingleAction(retryPayload.action, 0)], request, slides, {
      disableStoryExpansion: Boolean(executionPlan?.mode === 'deck' && currentPlanItem),
      currentPlanItem,
      stageSize,
      executionPlan
    });
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
          stageSize,
          request,
          currentPlanItem,
          imagePolicy: currentPlanItem?.imageIntent || inferRequestedImagePolicy(request)
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
          stageSize,
          request,
          currentPlanItem,
          imagePolicy: currentPlanItem?.imageIntent || inferRequestedImagePolicy(request)
        })
      )[0] || normalizedAction
  };
}

module.exports = {
  buildPublicAiSettings,
  normalizeActionList,
  editImageElementWithNanoBanana,
  proposeMagicPenActions,
  proposeNextSlideAction,
  proposeSlideExecutionPlan,
  proposeSlideActions: proposeSlideActionsSafely,
  generateBackgroundMaskWithNanoBanana,
  compareImagesWithNanoBanana,
  testAiConnection,
  __test: {
    normalizeActionList,
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
    inferRequestedImagePolicy,
    inferDeckVisualTheme,
    getThemeSlideStyle,
    requestSuggestsGamifiedSlides,
    requestSuggestsEducationalDeck,
    normalizeExecutionPlan,
    normalizePlanItemActions,
    createAiPrompt,
    createAiExecutionPlanPrompt,
    buildTemplateReferenceContext,
    ensureSlideIds,
    ensureElementIds,
    planItemHasRenderableContent,
    ensurePlanItemHasRenderableContent,
    applyDeckVisualThemeToActions,
    resolveActionLayoutCollisions,
    requestSuggestsStoryFlow,
    requestExplicitlyForbidsNewSlides,
    postProcessActions,
    extractMaskColor,
    parseNanoBananaJsonReply,
    areImageAttachmentsIdentical,
    normalizeProviderModel,
    getEffectiveChatModel,
    ensureRequiredImageGeneration,
    actionListNeedsNanoBanana,
    looksLikePlannerInstructionText,
    sanitizePlannerInstructionLeaks,
    convertInstructionToLessonText,
    sanitizeActionTextFit,
    collectActionQualityIssues,
    assertActionQuality,
    estimateTextCapacity,
    ensureImageSpacePlaceholder,
    repairEmptySupportBlockStacking,
    repairRemainingLayoutConflicts,
    repairDragDropDetectorConfiguration,
    addSupportCardsForReadableContent,
    ensureNarrativeForLonelyBulletMarkers
  }
};
