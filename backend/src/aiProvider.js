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
  'quiz',
  'floatingButton',
  'detector'
]);

const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
const DEFAULT_SLIDE_FLOW_TITLES = ['Introducao', 'Descoberta', 'Desafio'];
const MAX_SUMMARIZED_SLIDES = 3;
const MAX_SUMMARIZED_ELEMENTS_PER_SLIDE = 6;
const MAX_SUMMARIZED_LABEL_LENGTH = 48;
const MAX_REQUEST_LENGTH = 1800;
const MAX_ATTACHMENT_INSIGHTS_LENGTH = 600;
const MAX_STEPWISE_ACTIONS = 12;
const MAX_PROVIDER_MESSAGE_CHARS = 40000;
const MAX_PROVIDER_TOTAL_CHARS = 120000;
const MAX_REPAIR_ECHO_CHARS = 12000;
const BASIC_LAYOUT_RULES = [
  'Responda apenas com JSON valido.',
  'Retorne somente a estrutura pedida, sem markdown e sem explicacoes fora do JSON.',
  'Use somente os tipos de acao permitidos.',
  'Use somente os tipos de elemento permitidos.',
  'Pense apenas em montar o layout do slide com os recursos basicos da plataforma.',
  'Priorize text, block, image, floatingButton e animacoes basicas quando fizer sentido.',
  'Nao invente HTML, CSS, DOM, codigo, componentes externos ou ferramentas que nao existam no editor.',
  'Use o palco 1280x720 como limite absoluto.',
  'Mantenha todos os elementos dentro da area visivel e com margens seguras.',
  'Considere o palco como um limite rigido: nenhum x, y, width ou height pode empurrar qualquer parte do elemento para fora da area 1280x720.',
  'Antes de responder, confira o retangulo final de cada elemento para garantir que ele cabe inteiro no palco.',
  'Nao empilhe elementos sem necessidade. Evite colocar um card em cima do outro, um quiz em cima de outro ou texto em cima de botoes.',
  'Mantenha espacamento visual entre os elementos. Como regra pratica, deixe pelo menos 24px entre blocos principais, quizzes, imagens e botoes, salvo quando houver sobreposicao proposital muito clara.',
  'Se houver dois elementos grandes no mesmo slide, distribua em colunas ou em faixas verticais com respiro suficiente entre eles.',
  'Nao coloque quiz por cima de block, outro quiz, texto importante ou floatingButton.',
  'Nao coloque floatingButton em cima de quiz, titulo, area de resposta ou outro botao.',
  'Quando um elemento ocupar grande area do palco, reposicione os demais para sobrar espaco real, em vez de apenas diminuir um pouco e deixar tudo amontoado.',
  'Organize o layout com hierarquia clara entre titulo, subtitulo, conteudo e botoes.',
  'Distribua bem o espaco do palco. Evite concentrar tudo em um lado ou deixar grandes sobreposicoes desnecessarias.',
  'Quando usar blocos como cards ou paineis, mantenha o texto visualmente dentro deles com respiro interno.',
  'Sempre que houver texto importante sobre fundo ilustrado ou area visual complexa, prefira colocar um block ou card atras do texto para garantir leitura.',
  'Quando um texto for titulo, subtitulo, explicacao ou destaque, pense em bloco de apoio, faixa, card ou painel atras dele sempre que isso melhorar legibilidade e acabamento.',
  'Em elementos text, width e height representam o seletor, mas a tipografia pode ultrapassar esse box se a fonte estiver grande demais.',
  'Nao reduza apenas o tamanho do seletor de texto sem ajustar fontSize e quantidade de linhas. Sempre garanta que o texto caiba visualmente dentro da area escolhida.',
  'Se o texto estiver escapando do seletor, aumente width ou height, reduza fontSize, ou quebre o conteudo em mais linhas antes de responder.',
  'Titulos curtos podem usar fonte maior, mas textos longos precisam de box maior ou fonte menor para nao vazar e nao quebrar o layout.',
  'Garanta contraste forte entre fundo, blocos e texto.',
  'Aplique harmonia de cores no slide. Use paletas coerentes entre fundo, blocos, botoes e textos, evitando cores aleatorias sem relacao entre si.',
  'Prefira combinacoes harmonicas como monocromatica, analoga ou complementar suave. Use uma cor principal, uma cor de apoio e uma cor de destaque.',
  'Se usar bloco colorido com texto, escolha texto claro sobre bloco escuro ou texto escuro sobre bloco claro com contraste forte.',
  'Quando usar add_slide, envie slide com pelo menos id ou title.',
  'Quando usar update_slide, envie slideId e slide com propriedades reais para atualizar.',
  'Para fundo do slide, use slide.backgroundColor para cor lisa, slide.backgroundImage para URL/data URL existente ou slide.backgroundImagePrompt quando quiser que a plataforma gere a imagem do fundo.',
  'Nao tente simular fundo do slide criando um block gigante atras de tudo quando o objetivo for trocar o fundo. Para fundo, use as propriedades do proprio slide.',
  'Quando usar add_element, envie slideId e element completo.',
  'Quando usar update_element, envie slideId, elementId e element com propriedades reais para atualizar.',
  'Nao retorne acoes vazias, placeholders ou rascunhos.',
  'Nao invente slideId. So use ids que ja existam no contexto ou que tenham sido criados antes na mesma resposta.',
  'Se for criar elementos em um slide novo, primeiro crie o slide com add_slide e depois use esse id nas proximas acoes.',
  'Nao use elementId sozinho para criar elemento. Em add_element o objeto completo deve vir em element.',
  'Em text, o texto visivel deve ir em content. Nao use label como substituto de content.',
  'Use animacoes apenas quando ajudarem na leitura. Prefira fade-in, slide-left, zoom-in, pulse, float ou none.',
  'Evite sobreposicao excessiva e mantenha o layout simples e aplicavel.',
  'Use as ferramentas da plataforma de forma intencional: text para conteudo, block para estrutura visual, image para ilustracao, floatingButton para interacao, quiz para avaliacao, detector para area invisivel de gatilho, audio e video quando o pedido realmente exigir.',
  'Quando o pedido pedir slide interativo ou bem elaborado, combine layout forte com pelo menos uma interacao real usando floatingButton, quiz ou detector.',
  'Para floatingButton, use actionConfig funcional como nextSlide, jumpSlide, addText, replaceText, addImage, addVideo, addQuiz, moveElement ou playAnimation quando fizer sentido.',
  'Nao crie floatingButton vazio. Se houver floatingButton, ele deve ter actionConfig util e coerente com o objetivo do slide.',
  'Para ensinar a plataforma ou criar experiencia interativa, prefira botoes que revelem conteudo, avancem etapa, abram quiz, mudem texto, movam elemento ou naveguem entre slides.',
  'Ao usar floatingButton, pense no comportamento completo: o que acontece no clique, onde o conteudo aparece e se isso continua legivel no palco.',
  'Para quizzes, use pergunta, opcoes, alternativa correta e mensagens de sucesso ou erro. Mantenha tamanho suficiente e nao sobreponha quiz com botoes.',
  'Em quiz, use sempre question como string, options como array simples de strings, correctOption como indice numerico, successMessage, errorMessage, actionLabel, quizBackgroundColor, quizQuestionColor, quizOptionBackgroundColor, quizOptionTextColor, quizButtonBackgroundColor, points e lockOnWrong.',
  'Nunca retorne options ou quizOptions como objetos. Cada alternativa do quiz deve ser apenas texto puro.',
  'Se o slide ja possui um elemento quiz normal, nao crie um floatingButton redundante para validar resposta. O proprio quiz ja possui actionLabel e botao interno para isso.',
  'Use floatingButton apenas quando ele acrescentar algo que o quiz nao faz sozinho, como navegar, revelar conteudo, criar novo quiz, mover elemento, trocar texto ou tocar animacao.',
  'Quando actionConfig.type for addText, preencha text, insertX, insertY, insertWidth e insertHeight, e opcionalmente textColor, backgroundColor, fontSize, fontFamily, fontWeight, textAlign, hasTextBackground e hasTextBorder.',
  'Quando actionConfig.type for addQuiz, preencha quizQuestion, quizOptions, quizCorrectOption, successMessage, errorMessage, actionLabel, quizBackgroundColor, quizQuestionColor, quizOptionBackgroundColor, quizOptionTextColor, quizButtonBackgroundColor, points, lockOnWrong, insertX, insertY, insertWidth e insertHeight.',
  'Quando actionConfig.type for jumpSlide, preencha targetSlideId. Quando for moveElement ou playAnimation, preencha targetElementId. Quando for replaceText, preencha targetElementId e replaceText.',
  'Em actionConfig.type moveElement, use moveByX positivo para mover para a direita e moveByX negativo para mover para a esquerda.',
  'Exemplo pratico: para mover 160px para a esquerda, use moveByX: -160. Para mover 160px para a direita, use moveByX: 160.',
  'Em actionConfig.type moveElement, use moveByY positivo para mover para baixo e moveByY negativo para mover para cima.',
  'Exemplo pratico: para mover 80px para cima, use moveByY: -80. Para mover 80px para baixo, use moveByY: 80.',
  'Para detector, pense como uma area invisivel de acerto ou colisao. Use detector apenas quando houver logica de arrastar, encaixar ou disparar algo por sobreposicao.',
  'Detector e invisivel no viewer. E permitido posicionar block, text, image ou outros elementos visuais por cima dele quando isso fizer parte do layout, porque o detector funciona como area oculta.',
  'Como o aluno nao enxerga o detector, sempre que o objetivo for indicar onde existe uma area de encaixe, alvo, ponto de clique ou zona de acerto, adicione tambem um elemento visual de apoio, como block, text, image, seta ou rotulo explicativo.',
  'Nao entregue um detector sozinho quando o aluno precisar perceber aquela area. Use detector + elemento visual orientando a interacao.',
  'Para image, prefira generationPrompt quando precisar criar uma ilustracao nova coerente com o slide.',
  'Sempre que for possivel e fizer sentido pedagogico, prefira usar o gerador de imagens da plataforma para ilustrar o conteudo do slide, porque isso deixa a aula mais explicativa e visual.',
  'Slides de abertura, explicacao, comparacao, processo, ferramenta ou conceito costumam ficar melhores com pelo menos uma imagem gerada ou escolhida de forma coerente.',
  'Quando a imagem ajudar a explicar melhor, nao entregue o slide apenas com texto. Combine imagem com bloco e texto bem organizados.',
  'Para block e floatingButton, prefira cores no formato useGradient, gradientStart e gradientEnd. Se quiser cor unica, repita a mesma cor nos dois campos.',
  'Quando houver varios slides, mantenha continuidade visual e narrativa entre eles.'
];

function buildPublicAiSettings(row) {
  if (!row) {
    return {
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
  }
  return {
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
    'correctOption', 'animationDuration', 'animationDelay', 'points', 'options', 'actionConfig'
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
  if (typeof element.backgroundColor === 'string') normalized.backgroundColor = element.backgroundColor.trim();
  if (typeof element.solidColor === 'string') normalized.solidColor = element.solidColor.trim();
  if (typeof element.gradientStart === 'string') normalized.gradientStart = element.gradientStart.trim();
  if (typeof element.gradientEnd === 'string') normalized.gradientEnd = element.gradientEnd.trim();
  if (typeof element.useGradient === 'boolean') normalized.useGradient = element.useGradient;
  if (typeof element.hasTextBackground === 'boolean') normalized.hasTextBackground = element.hasTextBackground;
  if (typeof element.hasTextBorder === 'boolean') normalized.hasTextBorder = element.hasTextBorder;
  if (typeof element.hasTextBlock === 'boolean') normalized.hasTextBlock = element.hasTextBlock;
  if (typeof element.studentCanDrag === 'boolean') normalized.studentCanDrag = element.studentCanDrag;
  if (typeof element.question === 'string') normalized.question = element.question;
  if (typeof element.successMessage === 'string') normalized.successMessage = element.successMessage;
  if (typeof element.errorMessage === 'string') normalized.errorMessage = element.errorMessage;
  if (typeof element.actionLabel === 'string') normalized.actionLabel = element.actionLabel;
  if (typeof element.quizBackgroundColor === 'string') normalized.quizBackgroundColor = element.quizBackgroundColor.trim();
  if (typeof element.quizQuestionColor === 'string') normalized.quizQuestionColor = element.quizQuestionColor.trim();
  if (typeof element.quizOptionBackgroundColor === 'string') normalized.quizOptionBackgroundColor = element.quizOptionBackgroundColor.trim();
  if (typeof element.quizOptionTextColor === 'string') normalized.quizOptionTextColor = element.quizOptionTextColor.trim();
  if (typeof element.quizButtonBackgroundColor === 'string') normalized.quizButtonBackgroundColor = element.quizButtonBackgroundColor.trim();
  if (typeof element.lockOnWrong === 'boolean') normalized.lockOnWrong = element.lockOnWrong;
  if (typeof element.animationLoop === 'boolean') normalized.animationLoop = element.animationLoop;
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
  if (element.actionConfig && typeof element.actionConfig === 'object') {
    normalized.actionConfig = normalizeActionConfig(element.actionConfig);
  }
  return normalized;
}

function normalizeActionConfig(config) {
  const normalized = {};
  ['type', 'targetSlideId', 'targetElementId', 'text', 'url', 'quizQuestion', 'ruleGroup', 'textColor', 'backgroundColor', 'textAlign', 'fontFamily', 'fontWeight', 'successMessage', 'errorMessage', 'actionLabel', 'quizBackgroundColor', 'quizQuestionColor', 'quizOptionBackgroundColor', 'quizOptionTextColor', 'quizButtonBackgroundColor', 'replaceMode', 'replaceText'].forEach((key) => {
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
  ['insertX', 'insertY', 'insertWidth', 'insertHeight', 'quizCorrectOption', 'moveByX', 'moveByY', 'moveDuration', 'fontSize', 'points', 'replaceCounterStart', 'replaceCounterStep'].forEach((key) => {
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

function requestSuggestsStoryFlow(request) {
  return /(slides|varios slides|vários slides|historia|história|jornada|aventura|sequencia|sequência|passo a passo|capitulo|capítulo)/i.test(
    request || ''
  );
}

function requestSuggestsButtons(request) {
  return /(botao|botão|botoes|botões|acao|ação|interativo|interação|interacao|clicar|clique|naveg)/i.test(
    request || ''
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

function postProcessActions(actions, request, existingSlides = []) {
  let nextActions = ensureSlideIds(actions);
  nextActions = reuseInitialBlankSlide(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  nextActions = ensureMinimumStorySlides(nextActions, request, existingSlides);
  nextActions = ensureSlideIds(nextActions);
  nextActions = reuseInitialBlankSlide(nextActions, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  nextActions = ensureRequestedSlideCount(nextActions, request, existingSlides);
  nextActions = ensureSlideIds(nextActions);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  nextActions = ensureMinimumButtonActions(nextActions, request, existingSlides);
  nextActions = resolveSlideReferenceAliases(nextActions, existingSlides);
  nextActions = resolveElementReferenceAliases(nextActions, existingSlides);
  nextActions = repairButtonActions(nextActions, existingSlides);
  nextActions = normalizeMoveElementDirections(nextActions, existingSlides);
  nextActions = coercePlatformElementStyles(nextActions);
  return nextActions;
}

function needsRetry(actions, request, existingSlides = []) {
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

function createAiPrompt({ request, slides, activeSlideId, stageSize, attachments = [], attachmentInsights = '' }) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
  const compactInstructions = {
    role: 'slide_builder',
    rules: [
      ...BASIC_LAYOUT_RULES,
      'Retorne um array de acoes.',
      'Prefira editar slides existentes antes de criar muitos novos, a menos que o pedido exija.',
      'Se o pedido mencionar varios slides, voce pode criar uma sequencia curta com ids explicitos.',
      'Para imagens novas, prefira generationPrompt em vez de URL inventada.',
      'Se houver imagem anexada, use apenas o resumo dela como referencia visual.',
      'Quando usar floatingButton, configure actionConfig funcional e evite criar botoes decorativos sem efeito.',
      'Se o slide tiver quiz normal, nao adicione botao extra para validar resposta, porque o quiz ja tem botao interno.',
      'Se o pedido envolver fundo visual, prefira configurar backgroundColor, backgroundImage ou backgroundImagePrompt diretamente no slide.',
      'Quando o pedido for para ensinar, apresentar recursos, onboarding, tutorial, descoberta ou produtividade, prefira composicoes mais ricas com cards, destaques, botoes e uma progressao clara entre secoes.',
      'Quando o pedido pedir algo bem elaborado, use melhor distribuicao do palco, imagens ou ilustracoes relevantes, destaques em bloco e animacoes leves para guiar o olhar.',
      'Quando houver texto relevante, prefira usar block atras do texto para criar cards, faixas e areas de leitura mais profissionais.',
      'Quando a imagem ajudar na explicacao, prefira incluir image com generationPrompt ou backgroundImagePrompt no slide.',
      'Use harmonia de cores entre fundo, blocos, botoes e textos. Escolha uma direcao visual coerente e mantenha consistencia.',
      'Em text, nao confunda o tamanho do seletor com o tamanho visual final da tipografia. Ajuste width, height e fontSize juntos para o texto nao escapar.',
      'Se o slide tiver muitos elementos, reorganize em secoes com espacamento claro em vez de sobrepor componentes.',
      'Nao complique com audio, video ou motion-recording se o pedido nao exigir isso.'
    ],
    allowedActionTypes: Array.from(ALLOWED_ACTIONS),
    allowedElementTypes: Array.from(ALLOWED_ELEMENT_TYPES),
    jsonExample: [
      {
        type: 'add_slide',
        reason: 'Criar slide de abertura',
        slide: {
          id: 'slide-intro',
          title: 'Introducao',
          backgroundColor: '#fdfbff',
          backgroundImagePrompt: 'fundo clean e profissional sobre tecnologia educacional com tons suaves de azul'
        },
        setActive: true
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar bloco principal',
        element: {
          id: 'card-intro',
          type: 'block',
          x: 90,
          y: 110,
          width: 520,
          height: 420,
          useGradient: true,
          gradientStart: '#1d4ed8',
          gradientEnd: '#2563eb'
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar titulo',
        element: {
          id: 'titulo-intro',
          type: 'text',
          content: 'Como usar a plataforma',
          x: 130,
          y: 150,
          width: 420,
          height: 70,
          fontSize: 34,
          fontWeight: '700',
          textColor: '#ffffff',
          animationType: 'fade-in',
          animationDuration: 1
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar botao para revelar uma dica util',
        element: {
          id: 'botao-avancar',
          type: 'floatingButton',
          label: 'Ver dica',
          x: 130,
          y: 460,
          width: 180,
          height: 56,
          useGradient: true,
          gradientStart: '#f97316',
          gradientEnd: '#fb923c',
          actionConfig: {
            type: 'addText',
            text: 'A plataforma centraliza aulas, materiais e progresso em um unico fluxo.',
            textColor: '#1f2340',
            backgroundColor: '#ffffff',
            fontSize: 22,
            fontWeight: '600',
            hasTextBackground: true,
            insertX: 660,
            insertY: 500,
            insertWidth: 430,
            insertHeight: 90
          }
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar quiz curto para interacao',
        element: {
          id: 'quiz-intro',
          type: 'quiz',
          question: 'Qual recurso ajuda o aluno a navegar entre etapas?',
          options: ['floatingButton', 'backgroundColor', 'fontWeight'],
          correctOption: 0,
          x: 660,
          y: 150,
          width: 460,
          height: 300,
          successMessage: 'Correto! O botao pode levar para outra etapa.',
          errorMessage: 'Tente novamente observando os elementos interativos.'
        }
      }
    ],
    userRequest: truncateText(request, MAX_REQUEST_LENGTH),
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  };
  return JSON.stringify(compactInstructions);
  const instructions = {
    role: 'slide_builder',
    rules: [
      'Responda apenas com JSON valido.',
      'Retorne um array de acoes.',
      'Use somente os tipos de acao permitidos.',
      'Use somente os campos e comportamentos que ja existem na plataforma. Nao invente ferramentas, propriedades, componentes, HTML, CSS, DOM ou codigo.',
      'Nunca descreva a solucao como mudanca de HTML. Sempre pense em acoes do editor e propriedades do estado dos slides.',
      'Quando usar add_element, informe slideId e element.',
      'Nunca retorne add_element vazio. add_element sem slideId ou sem element e invalido.',
      'Nunca retorne update_element vazio. update_element exige slideId, elementId e element com pelo menos uma propriedade real para atualizar.',
      'Nunca retorne update_slide vazio. update_slide exige slideId e slide com pelo menos uma propriedade real para atualizar.',
      'Nunca retorne add_slide vazio. add_slide exige slide com pelo menos id ou title.',
      'Nao retorne acoes-placeholder, rascunhos ou etapas incompletas. Cada acao precisa estar pronta para aplicar.',
      'Nao invente slideId. So referencie um slide se ele ja existir no contexto ou se voce o criou antes na mesma resposta com add_slide.',
      'Se for criar elementos em um slide novo, primeiro crie o slide com add_slide e depois use esse mesmo id nas acoes seguintes.',
      'Nao use elementId sozinho em add_element. Para criar elemento, descreva o objeto completo em element.',
      'Em elementos do tipo text, o texto visivel deve ficar em content. label serve apenas como rotulo interno quando fizer sentido.',
      'Nao use label como substituto de content em text.',
      'Se voce quiser apenas criar um elemento novo, use add_element. So use update_element quando o alvo ja existir de verdade.',
      'Se nao tiver certeza de que um elementId ja existe, prefira add_element com element.id explicito em vez de update_element.',
      'Voce pode criar varios slides em sequencia para contar uma historia, jornada, missao, aula guiada ou aventura educativa.',
      'Quando criar varios slides, de ids explicitos aos slides para conseguir referenciar a navegacao entre eles com targetSlideId.',
      'Estruture a historia com continuidade entre os slides: introducao, descoberta, desafio, resposta, recompensa ou conclusao.',
      'Respeite rigorosamente os limites do palco. Nao posicione elementos fora da area visivel e nao deixe largura, altura, x ou y ultrapassarem o palco.',
      'Considere o palco padrao como 1280x720 e mantenha margens visuais seguras nas bordas.',
      'Use o palco 1280x720 como limite absoluto. Organize os elementos pensando nesse espaco inteiro antes de posicionar qualquer item.',
      'Ao compor layouts, distribua os elementos para evitar sobreposicao excessiva e para manter leitura clara dentro do palco.',
      'Organize blocos, textos, imagens e botoes com alinhamento profissional: alinhe bordas, respeite uma grade visual, mantenha respiros consistentes e evite elementos desalinhados.',
      'Quando houver varios blocos, use larguras, alturas e espacamentos coerentes entre si para formar colunas, cards ou secoes bem organizadas.',
      'Ao posicionar textos, mantenha hierarquia clara entre titulo, subtitulo e corpo. Alinhe o texto ao bloco ou area correspondente e preserve margens internas confortaveis.',
      'Sempre que houver um bloco servindo de card, painel ou caixa de conteudo, mantenha o texto visualmente dentro desse bloco.',
      'Nao deixe textos importantes soltos fora dos blocos quando houver um bloco correspondente no layout.',
      'Ao escolher cor de texto, sempre garanta contraste forte com o fundo. Se o fundo, bloco ou imagem for escuro, use texto claro. Se o fundo, bloco ou imagem for claro, use texto escuro.',
      'Se houver imagem escura atras do texto, adicione bloco, sobreposicao ou ajuste de cor para manter legibilidade imediata.',
      'Se um texto estiver associado a um bloco visual, posicione o texto dentro dele com alinhamento equilibrado, sem encostar nas bordas e sem parecer solto no palco.',
      'Prefira composicoes com simetria parcial ou grade bem resolvida, com leitura limpa e acabamento profissional.',
      'Priorize slides didaticos e interativos como se fossem pequenas fases de um jogo educativo.',
      'Explore fortemente floatingButton com actionConfig para criar exploracao, descoberta, progressao, navegacao, escolha e revelacao de conteudo.',
      'Prefira experiencias em que o aluno clica, escolhe, avanca ou desbloqueia informacoes, em vez de slides puramente estaticos.',
      'Use blocos e botoes flutuantes como formas geometricas para desenhar composicoes visuais. Os tipos block e floatingButton aceitam shape rectangle, circle, triangle e arrow.',
      'Combine varios blocos geometricos para montar paineis, cards, setas, destaques, molduras, caminhos, personagens abstratos ou interfaces ludicas.',
      'Considere que block agora possui editor flutuante proprio e suporta configuracao completa de conteudo, largura, altura, rotacao, camada, shape, gradiente, cor solida, cor do texto e tipografia.',
      'Para mudar a cor de blocos, botoes e setas, prefira ativar useGradient e preencher gradientStart e gradientEnd.',
      'Quando o usuario pedir uma cor unica em bloco, botao ou seta, use useGradient true e repita a mesma cor em gradientStart e gradientEnd.',
      'Quando o usuario pedir para mudar a cor de um bloco existente, prefira update_element com useGradient true, gradientStart e gradientEnd preenchidos.',
      'Quando o usuario pedir para configurar bloco, card, caixa, painel ou shape, pense no tipo block como um elemento visual configuravel pelo editor flutuante do bloco.',
      'Ao usar gradiente, escolha combinacoes harmonicas e legiveis. Use contrastes claros entre fundo e texto.',
      'Se quiser efeito de cor unica, use useGradient true com gradientStart e gradientEnd iguais.',
      'Aplique principios de harmonia de cores: analogas para suavidade, complementares para destaque, triadicas para energia equilibrada e monocromaticas para clareza.',
      'Evite paletas aleatorias. Cada slide deve ter direcao visual consistente entre fundo, blocos, botoes e textos.',
      'Voce pode definir o fundo do slide com slide.backgroundColor para cor lisa ou slide.backgroundImage para imagem de fundo por URL.',
      'Quando a proposta ficar melhor com ambiente ilustrado, use slide.backgroundImage com URL. Quando precisar de clareza, performance ou visual mais limpo, use slide.backgroundColor.',
      'Se usar imagem de fundo, mantenha contraste suficiente para texto e elementos interativos. Se necessario, complemente com blocos sobrepostos.',
      'Se houver imagem anexada pelo usuario, considere esse anexo como referencia visual adicional do pedido.',
      'Prefira usar o gerador de imagem da plataforma para ilustrar conceitos, ambientar a cena e deixar o slide mais bonito quando isso ajudar na compreensao.',
      'Nao precisa colocar imagem em todos os slides, mas em slides de abertura, explicacao, comparacao ou ilustracao normalmente vale a pena ter pelo menos uma imagem relevante.',
      'Quando quiser uma imagem criada pela plataforma, prefira generationPrompt em vez de URL inventada.',
      'Botoes flutuantes e detectores podem usar actionConfig.type como nextSlide, jumpSlide, addText, replaceText, addImage, addVideo, addQuiz, moveElement ou playAnimation.',
      'Quando um floatingButton fizer parte do desenho ou da area clicavel, voce pode definir shape rectangle, circle, triangle ou arrow para transformar o proprio botao em forma interativa.',
      'Quando usar floatingButton, configure targetSlideId, targetElementId, text, url, quizQuestion, quizOptions, quizCorrectOption, moveByX, moveByY, moveDuration e posicao de insercao quando necessario.',
      'Quando actionConfig.type for addText em floatingButton ou detector, voce pode e deve configurar o texto inserido com text, textColor, backgroundColor, fontSize, fontFamily, fontWeight, textAlign, hasTextBackground, hasTextBorder e hasTextBlock, alem de insertWidth e insertHeight.',
      'Sempre que o usuario pedir um texto desbloqueado visualmente rico, aplique no addText a mesma logica de personalizacao do editor de texto da plataforma em vez de inserir um texto cru.',
      'Use actionConfig.type replaceText quando o clique ou detector precisar trocar o conteudo de um texto, bloco ou rotulo de botao ja existente. Nessa acao, preencha targetElementId.',
      'Em replaceText, use replaceMode replace para trocar todo o conteudo do alvo usando replaceText.',
      'Em replaceText, use replaceMode counter quando o usuario quiser contador, soma visual, placar, tentativas, pontos ou progresso numerico concatenado. Nesse caso, preencha replaceText como prefixo e ajuste replaceCounterStart e replaceCounterStep quando necessario.',
      'Quando actionConfig.type for addQuiz em floatingButton ou detector, configure o quiz completo com quizQuestion, quizOptions, quizCorrectOption, successMessage, errorMessage, actionLabel, quizBackgroundColor, quizQuestionColor, quizOptionBackgroundColor, quizOptionTextColor, quizButtonBackgroundColor, points, lockOnWrong, insertWidth e insertHeight.',
      'Nao crie addQuiz simplificado quando o pedido pedir quiz estilizado ou com comportamento especifico. Use todas as configuracoes necessarias do quiz real da plataforma.',
      'Use actionConfig.type moveElement quando o clique no floatingButton precisar deslocar image, block ou text ja existente. Nessa acao, preencha targetElementId e quantos pixels mover em moveByX e moveByY.',
      'moveByX e moveByY aceitam numeros positivos e negativos. Use valores negativos quando o elemento precisar ir para a esquerda ou para cima.',
      'Use actionConfig.type playAnimation quando o clique no floatingButton ou detector precisar disparar a animacao ja configurada de um image, block ou text. Nessa acao, preencha targetElementId.',
      'Voce tambem pode criar regras opcionais de botao com actionConfig.requireAllButtonsInGroup true e actionConfig.ruleGroup para que a acao so execute depois de clicar em todos os botoes daquele grupo no mesmo slide.',
      'O tipo detector representa uma area invisivel no palco. Ele funciona como um bloco invisivel e serve para detectar quando o aluno arrasta um elemento por cima dele.',
      'Use detector quando o usuario pedir area de encaixe, zona de acerto, alvo invisivel, drop zone, detector de colisao ou gatilho por sobreposicao.',
      'Detector nao precisa de label nem conteudo. Configure largura, altura, x e y como se fosse um bloco invisivel.',
      'Quando um detector disparar uma acao, use actionConfig do mesmo jeito que em floatingButton. Ele pode mover um elemento, tocar uma animacao, ir para outro slide ou inserir novo conteudo.',
      'Os tipos text, block e image aceitam studentCanDrag true quando o aluno deve poder arrastar esse elemento no viewer.',
      'Use studentCanDrag true apenas quando houver motivo pedagogico ou interativo claro, como arrastar uma resposta, um cartao, uma imagem ou uma etiqueta.',
      'Quizzes podem usar points para definir pontuacao e lockOnWrong true para bloquear nova tentativa apos erro.',
      'Ao criar quiz, respeite a altura minima real do componente: 300px com 3 opcoes, 350px com 4 opcoes e adicione 50px de altura para cada opcao extra.',
      'Nunca coloque quiz por cima de botoes flutuantes e nunca coloque botoes por cima de quizzes.',
      'Mantenha distancia minima entre quiz e botoes para que a area clicavel de um nao atrapalhe o outro.',
      'Quando um floatingButton inserir elemento no palco com addText, addImage, addVideo ou addQuiz, posicione o novo elemento em area livre do palco. Nunca coloque o elemento inserido em cima de outros botoes ou quizzes.',
      'Se faltar espaco, reduza um pouco a fonte ou ajuste largura e altura do elemento inserido, mas ainda respeite o limite do palco e evite sobreposicao com botoes e quizzes.',
      'Slides podem usar requireQuizCompletion true para bloquear o avancar ate que os quizzes daquele slide sejam respondidos.',
      'Use nextSlide para progressao linear, jumpSlide para caminhos narrativos, addText/addQuiz/addImage/addVideo para desbloquear conteudo no proprio slide e replaceText para atualizar texto ja existente.',
      'Ao criar historias com varios slides, inclua botoes que levem o aluno adiante, voltem para revisao ou revelem pistas e desafios.',
      'Sempre que possivel, faca cada slide ter pelo menos um ponto de interacao claro com botao, quiz ou escolha.',
      'Se o usuario pedir algo visualmente rico, pense primeiro em layout, formas, cores, hierarquia e interacao; depois no texto.',
      'Para image, audio e video use apenas URLs ou generationPrompt quando quiser que a plataforma gere uma imagem nova.',
      'A plataforma possui uma borracha para image e block. Quando o usuario pedir para apagar parte de uma imagem ou bloco, nao invente nova ferramenta: prefira manter o elemento como image ou block e, se precisar orientar a edicao, descreva que a borracha pode apagar partes manualmente com transparencia.',
      'Quando precisar de uma imagem nova criada por IA, use element.generationPrompt para elementos image, slide.backgroundImagePrompt para fundos ou actionConfig.generationPrompt quando um floatingButton criar imagem no clique.',
      'Pense no modelo de texto como responsavel por estrategia, estrutura, hierarquia, contraste, posicionamento e layout.',
      'Quando houver gerador de imagem disponivel, trate o modelo de imagem como responsavel por materializar visualmente a composicao planejada a partir do layout, do pedido e das referencias enviadas.',
      'Nao invente imagens hospedadas em URLs aleatorias. Quando nao houver URL confiavel, prefira generationPrompt para a plataforma gerar a imagem.',
      'Nao inclua markdown, comentarios ou explicacoes fora do JSON.',
      'Prefira editar slides existentes antes de criar muitos novos, a menos que o pedido exija.',
      'Todos os elementos devem caber em um palco 1280x720 por padrao.',
      'Para block e floatingButton, represente cores usando o formato nativo da plataforma: useGradient, gradientStart e gradientEnd. Se for cor unica, repita a mesma cor no inicio e no fim.',
      'Voce pode animar text, block, floatingButton e image com animationType, animationDuration, animationDelay e animationLoop. Use animacoes com moderacao para destacar entradas, saidas e movimentos suaves.',
      'Os animationType permitidos sao: fade-in, fade-out, slide-left, slide-right, rotate-in, pulse, float, zoom-in, motion-recording e none.',
      'motion-recording serve para criar movimentacao quadro a quadro em image, block e text.',
      'Quando usar motion-recording, forneca motionFrames como uma lista ordenada de quadros. Cada quadro pode ter x, y, width, height, rotation e opacity.',
      'Pense no botao Gravar quadro atual como a captura de uma pose exata do elemento no palco. Cada clique nesse botao registra um frame completo da posicao e da aparencia atual do elemento.',
      'Para motion-recording, crie pelo menos 2 quadros quando quiser deslocamento real. O primeiro quadro representa o estado inicial e os seguintes representam o caminho da animacao.',
      'Pense em motion-recording como uma gravacao de poses sucessivas do elemento no palco. O efeito final depende da diferenca gradual entre um quadro e o seguinte.',
      'Quando o pedido exigir animacao personalizada, criativa ou mais viva do que as animacoes prontas, prefira motion-recording e imagine a sequencia como se estivesse apertando Gravar quadro atual varias vezes ao reposicionar o elemento no palco.',
      'Ao planejar motion-recording, defina uma pose inicial, grave quadros intermediarios com pequenas mudancas de x, y, width, height, rotation e opacity, e depois grave a pose final.',
      'Use motion-recording para criar curvas, aproximacoes, balanço, entrada em arco, leve rotacao progressiva, zoom combinado com deslocamento e outras trajetorias que os presets prontos nao conseguem reproduzir.',
      'Ao montar motionFrames, use o palco 1280x720 como referencia absoluta. Calcule deslocamentos com base nesse espaco total e mantenha o elemento sempre dentro da area visivel.',
      'Para o movimento parecer natural, distribua os quadros ao longo do palco em passos progressivos, evitando saltos grandes demais entre dois quadros vizinhos.',
      'Se o usuario pedir um movimento curto e suave, use de 3 a 5 quadros. Se pedir um trajeto mais longo, use de 5 a 8 quadros.',
      'Como regra pratica, tente fazer cada salto entre quadros representar algo em torno de 4% a 12% da largura do palco no eixo X e 4% a 12% da altura do palco no eixo Y, salvo quando o pedido exigir um salto dramatico.',
      'Em um palco 1280x720, isso normalmente significa avancos aproximados de 50 a 150 pixels no eixo X e 30 a 85 pixels no eixo Y por quadro em movimentos suaves.',
      'Se o elemento precisar atravessar grande parte do palco, nao use apenas quadro inicial e quadro final. Crie quadros intermediarios para o cerebro perceber continuidade e direcao.',
      'Quando quiser que pareca que o elemento acelera ou desacelera, use espacamentos desiguais entre os quadros: menores no inicio e maiores no meio para acelerar, ou maiores no inicio e menores no fim para desacelerar.',
      'Quando quiser que pareca um movimento linear simples, mantenha diferencas parecidas de x e y entre os quadros consecutivos.',
      'Voce tambem pode variar width, height e rotation entre os quadros para simular aproximacao, afastamento, inclinacao ou reposicionamento mais vivo, mas faca isso gradualmente.',
      'Para entrada lateral, comece com o elemento parcialmente fora ou perto da borda segura e aproxime quadro a quadro ate a posicao final. Para subida ou descida, faca o mesmo no eixo Y.',
      'Para parecer que uma imagem, bloco ou texto esta realmente se movendo, prefira varios quadros pequenos e coerentes em vez de poucos quadros com diferencas bruscas.',
      'Se o usuario pedir para ensinar a configurar animacao, responda usando motion-recording quando houver movimento no palco e descreva o raciocinio dos quadros em termos de posicao inicial, quadros intermediarios e posicao final.',
      'Use motion-recording principalmente para deslocamento de imagem, bloco ou texto, entrada dramatica, aproximacao, mudanca de escala, reposicionamento de card ou movimento guiado no palco.',
      'Nao use motion-recording em quiz, audio, video ou floatingButton.',
      'Use animacao principalmente em titulo, imagem principal, cards de destaque e botao principal quando isso ajudar a guiar o olhar do aluno.',
      'Evite animar muitos elementos ao mesmo tempo no mesmo slide. Prefira de 1 a 3 animacoes relevantes por slide.',
      'Para entrada suave de titulo ou bloco, prefira fade-in ou slide-left. Para imagem hero, prefira zoom-in ou float. Para CTA, prefira pulse ou float. Para destaque dramatico, prefira rotate-in com moderacao.',
      'Quando usar animationDelay, escalone a entrada visual: por exemplo titulo primeiro, bloco depois, botao por ultimo.',
      'Use animationLoop true apenas para efeitos sutis e continuos como pulse ou float. Para entradas e saídas, prefira animationLoop false.',
      'Se quiser manter um elemento animado continuamente, use animationLoop true. Isso funciona melhor com pulse e float em botoes principais, imagens de destaque, cards importantes e elementos que devam permanecer chamando atencao.',
      'Evite animationLoop true em muitos elementos ao mesmo tempo. Prefira no maximo 1 ou 2 elementos continuamente animados por slide.',
      'Nao use animationType em quiz, audio ou video.',
      'Quando o usuario pedir para ensinar ou configurar animacao, prefira responder com a propria configuracao do elemento: escolha animationType adequado, ajuste animationDuration e animationDelay, e use animationLoop apenas quando houver motivo visual.'
    ],
    allowedActionTypes: Array.from(ALLOWED_ACTIONS),
    allowedElementTypes: Array.from(ALLOWED_ELEMENT_TYPES),
    jsonExample: [
      {
        type: 'add_slide',
        reason: 'Criar slide de abertura',
        slide: { id: 'slide-intro', title: 'Introducao', backgroundColor: '#fdfbff' },
        setActive: true
      },
      {
        type: 'update_slide',
        slideId: 'slide-alvo',
        reason: 'Aplicar um fundo visual ao slide',
        slide: {
          backgroundImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80',
          backgroundColor: '#eef3ff'
        }
      },
      {
        type: 'update_element',
        slideId: 'slide-alvo',
        elementId: 'elemento-bloco',
        reason: 'Trocar a cor do bloco para destacar a secao',
        element: {
          useGradient: true,
          gradientStart: '#ffd54f',
          gradientEnd: '#ffd54f',
          backgroundColor: '#ffd54f',
          solidColor: '#ffd54f'
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar titulo principal',
        element: {
          type: 'text',
          content: 'Bem-vindo',
          x: 120,
          y: 80,
          width: 500,
          height: 120,
          fontSize: 34,
          fontWeight: '700',
          textColor: '#171934',
          animationType: 'fade-in',
          animationDuration: 1,
          animationDelay: 0,
          animationLoop: false
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar imagem principal com entrada suave',
        element: {
          type: 'image',
          x: 760,
          y: 120,
          width: 340,
          height: 240,
          generationPrompt: 'ilustracao clean e profissional sobre tecnologia educacional',
          animationType: 'zoom-in',
          animationDuration: 1.4,
          animationDelay: 0.2,
          animationLoop: false
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar botao interativo para revelar o proximo passo',
        element: {
          type: 'floatingButton',
          label: 'Explorar',
          shape: 'circle',
          x: 950,
          y: 560,
          width: 180,
          height: 64,
          fontSize: 20,
          fontWeight: '700',
          useGradient: true,
          gradientStart: '#ff8a5b',
          gradientEnd: '#ffd166',
          backgroundColor: '#ff8a5b',
          solidColor: '#ff8a5b',
          animationType: 'pulse',
          animationDuration: 2.4,
          animationDelay: 0.6,
          animationLoop: true,
          actionConfig: {
            type: 'addText',
            requireAllButtonsInGroup: true,
            ruleGroup: 'pistas-secretas',
            text: 'Parabens! Voce desbloqueou a proxima pista.',
            insertX: 720,
            insertY: 180,
            insertWidth: 360,
            insertHeight: 120
          }
        }
      },
      {
        type: 'add_slide',
        reason: 'Criar segundo slide para continuar a historia',
        afterSlideId: 'slide-intro',
        slide: {
          id: 'slide-desafio',
          title: 'Desafio',
          backgroundColor: '#eef6ff'
        }
      },
      {
        type: 'add_element',
        slideId: 'slide-intro',
        reason: 'Adicionar botao para navegar para o slide de desafio',
        element: {
          type: 'floatingButton',
          label: 'Ir para o desafio',
          x: 920,
          y: 80,
          width: 220,
          height: 60,
          fontSize: 18,
          fontWeight: '700',
          useGradient: true,
          gradientStart: '#5b8cff',
          gradientEnd: '#27d3ec',
          backgroundColor: '#5b8cff',
          solidColor: '#5b8cff',
          actionConfig: {
            type: 'jumpSlide',
            targetSlideId: 'slide-desafio'
          }
        }
      }
    ],
    userRequest: truncateText(request, MAX_REQUEST_LENGTH),
    context: {
      activeSlideId: activeSlideId || null,
      stageSize: safeStage,
      slides: orderedSlides,
      attachmentInsights: truncateText(attachmentInsights, MAX_ATTACHMENT_INSIGHTS_LENGTH),
      attachmentCount: attachments.length
    }
  };
  return JSON.stringify(instructions);
}

function createAiStepPrompt({ request, slides, activeSlideId, stageSize, stepIndex = 0, recentActions = [], attachments = [], attachmentInsights = '' }) {
  const safeStage = stageSize?.width && stageSize?.height ? stageSize : DEFAULT_STAGE_SIZE;
  const orderedSlides = summarizeSlides(slides, activeSlideId);
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
      'Mantenha o layout simples, legivel e dentro do palco 1280x720.',
      'Antes de responder, confira se nenhum elemento ultrapassa o palco ou fica cortado.',
      'Cheque se os elementos nao estao montados um sobre o outro. Reorganize com espaco real entre cards, quizzes, blocos e botoes.',
      'Prefira texto importante com bloco ou card atras quando isso melhorar legibilidade.',
      'Cheque se textos realmente cabem no box escolhido. Se a fonte estiver grande demais para width e height, ajuste antes de responder.',
      'Use contraste forte entre fundo, blocos e texto.',
      'Use paleta harmonica e coerente entre fundo, blocos e botoes.',
      'Use animacoes simples quando fizer sentido: fade-in, slide-left, zoom-in, pulse, float ou none.',
      'Se o pedido pedir interatividade, prefira floatingButton, quiz ou detector com comportamento funcional.',
      'Nunca crie floatingButton vazio. Se houver botao, ele precisa ter actionConfig util para navegar, revelar conteudo, abrir quiz, mover elemento ou tocar animacao.',
      'Se usar moveElement, lembre: moveByX positivo move para a direita, moveByX negativo move para a esquerda, moveByY positivo move para baixo e moveByY negativo move para cima.',
      'Exemplo obrigatorio de referencia: esquerda = moveByX: -160, direita = moveByX: 160, cima = moveByY: -80, baixo = moveByY: 80.',
      'Nao adicione floatingButton para validar quiz comum, porque o proprio quiz ja possui botao interno.',
      'Se usar detector, lembre que ele e invisivel para o aluno. Adicione um elemento visual de apoio quando a area precisar ser percebida.',
      'Use os recursos da plataforma de forma intencional: block para estrutura, text para conteudo, image para ilustracao, floatingButton para acao, quiz para avaliacao e detector para gatilhos invisiveis.',
      'Quando a imagem ajudar a explicar melhor, prefira incluir image com generationPrompt ou fundo com backgroundImagePrompt.',
      'Se houver imagem anexada, use apenas o resumo dela no contexto como referencia visual do pedido.'
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
      'Cheque se todo floatingButton possui actionConfig util e nao ficou apenas decorativo.',
      'Cheque se nao existe botao redundante tentando validar um quiz comum.',
      'Cheque se moveElement usa a direcao correta: moveByX positivo para direita, negativo para esquerda, moveByY positivo para baixo e negativo para cima.',
      'Se a proposta disser para mover para a esquerda e o valor estiver positivo, considere isso errado. Esquerda precisa de valor negativo, como -160.',
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
      const targetSlide = findPlanningSlide(planningState, action.slideId);
      if (targetSlide && action.slide) {
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

async function describeAttachmentsWithNanoBanana({ imageSettings, attachments = [] }) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  if (!normalizedAttachments.length || !imageSettings?.image_encrypted_api_key || imageSettings.image_is_enabled === false) {
    return '';
  }
  const parts = [
    ...normalizedAttachments.map((attachment) => ({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.data
      }
    })),
    {
      text:
        'Descreva em portugues, de forma curta e objetiva, o que aparece na imagem anexada e quais detalhes visuais importam para criar um slide interativo alinhado ao pedido do usuario.'
    }
  ];
  const body = await callGoogleGenerateContent({
    settings: imageSettings,
    parts
  });
  return extractGoogleText(body);
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

async function collectStepwiseActions({
  settingsRow,
  request,
  slides,
  activeSlideId,
  stageSize,
  attachments = [],
  attachmentInsights = ''
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
      attachmentInsights
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
    attachmentInsights
  });

  if (!reviewResult.done && reviewResult.action) {
    collectedActions.push(JSON.parse(JSON.stringify(reviewResult.action)));
  }

  return collectedActions;
}

async function proposeSlideActions({ settingsRow, request, slides, activeSlideId, stageSize, attachments = [] }) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const attachmentInsights = await describeAttachmentsWithNanoBanana({
    imageSettings: settingsRow,
    attachments: normalizedAttachments
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
          attachmentInsights
        })
      )
    }
  ];

  const firstContent = await callCompatibleChatApi({
    settings: settingsRow,
    messages: baseMessages
  });
  const firstParsed = await parseActionsFromModelContent(settingsRow, baseMessages, firstContent);
  let actions = postProcessActions(normalizeActionList(firstParsed), request, slides);

  if (needsRetry(actions, request, slides)) {
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
    actions = postProcessActions(normalizeActionList(retryParsed), request, slides);
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
      attachments: normalizedAttachments
    });
    const fallbackActions = await collectStepwiseActions({
      settingsRow: args?.settingsRow,
      request: args?.request,
      slides: Array.isArray(args?.slides) ? args.slides : [],
      activeSlideId: args?.activeSlideId || null,
      stageSize: args?.stageSize || null,
      attachments: normalizedAttachments,
      attachmentInsights
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
  attachmentInsights = ''
}) {
  const normalizedAttachments = normalizeImageAttachments(attachments);
  const resolvedAttachmentInsights =
    typeof attachmentInsights === 'string' && attachmentInsights.trim()
      ? attachmentInsights.trim()
      : await describeAttachmentsWithNanoBanana({
          imageSettings: settingsRow,
          attachments: normalizedAttachments
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
              attachmentInsights: resolvedAttachmentInsights
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
  proposeNextSlideAction,
  proposeSlideActions: proposeSlideActionsSafely,
  generateBackgroundMaskWithNanoBanana,
  testAiConnection,
  __test: {
    extractJsonContent,
    extractBalancedJsonSubstring,
    sanitizeJsonCandidate,
    tryParseJsonCandidate,
    extractJsonArraySubstring,
    parseStepPayload,
    summarizeSlides,
    truncateText,
    applyActionToPlanningState,
    isRecoverableJsonError,
    extractMaskColor
  }
};
