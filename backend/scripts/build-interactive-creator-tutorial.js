const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, '../../template-store/1tutorial-completo-do-interactive-creator.json');
const STAGE = { width: 1280, height: 720 };
const COLORS = {
  ink: '#16213a',
  muted: '#526078',
  paper: '#f7f9fc',
  white: '#ffffff',
  navy: '#17324d',
  teal: '#0f766e',
  mint: '#d9f2ea',
  yellow: '#f4c95d',
  coral: '#eb6b56',
  blue: '#3b82b8',
  sky: '#dceef8',
  lilac: '#e9e4f6',
  green: '#278a62',
  red: '#c53f4f'
};

const coverage = [
  'dados-do-modulo', 'curso', 'titulo', 'descricao', 'capa-local-url', 'salvar-modulo', 'novo-modulo',
  'modulos-publicados', 'exportar-template', 'importar-template', 'baixar-slides', 'loja-de-templates',
  'fundo-cor', 'fundo-gradiente', 'fundo-imagem', 'fundo-video', 'fundo-em-lote',
  'novo-slide', 'renomear-slide', 'duplicar-conteudo', 'excluir-slide', 'limpar-slide', 'faixa-de-slides',
  'selecionar', 'mover', 'redimensionar', 'rotacionar', 'opacidade', 'atalhos-de-teclado', 'camadas',
  'desfazer', 'refazer', 'copiar', 'colar', 'remover-elemento',
  'texto', 'bloco', 'imagem', 'audio', 'video', 'camera', 'quiz', 'caneta', 'input', 'botao-flutuante',
  'detector', 'gatilho-por-tempo', 'borracha', 'animacao', 'tecla', 'seta-animada',
  'texto-fonte-peso-alinhamento-cor-fundo-borda', 'bloco-formas-gradiente-textura',
  'imagem-local-url-ajuste-arrastar-remover-fundo-editar-ia',
  'audio-local-url-loop-coleta-legendas', 'video-local-url-youtube-legendas-extrair-audio',
  'camera-ativar-foto-gravar-parar', 'quiz-feedback-pontos-bloqueio-acerto-erro',
  'input-comparacao-maiusculas-anexo-imagem-audio-cores',
  'gatilhos-adicionar-duplicar-remover-ativar', 'gatilho-teclado', 'regra-de-grupo',
  'acao-none', 'acao-proximo-slide', 'acao-ir-slide', 'acao-redirecionar', 'acao-adicionar-texto',
  'acao-substituir-texto', 'acao-adicionar-imagem', 'acao-adicionar-audio', 'acao-adicionar-video',
  'acao-adicionar-quiz', 'acao-tocar-audio', 'acao-tocar-video', 'acao-pausar-video',
  'acao-buscar-video', 'acao-mostrar', 'acao-esconder', 'acao-mover', 'acao-animar', 'acao-alternar-gatilho',
  'detector-qualquer-tipo-elemento-contagem-uma-vez', 'temporizador', 'gatilhos-de-video',
  'caneta-cor-espessura-aluno-pincel-magico', 'borracha-pincel-laco-escopo-tamanho-restaurar-aplicar',
  'animacoes-efeito-duracao-atraso-loop-quadros',
  '3d-ativar-catalogo-busca-primitivas-importar-biblioteca-excluir-controle-posicao-animacao-reset-fixar',
  'ia-prompt-imagem-planejar-aplicar-descartar-selecao-creditos',
  'seguranca-travar-proximo-quiz-obrigatorio-link-publico-caneta-aluno-reconhecimento-facial',
  'aula-ao-vivo-iniciar-publicar-manual-camera-tela-cursores-link', 'previa-do-aluno', 'concluir-e-publicar'
];

const baseElement = (type, id, x, y, width, height, zIndex = 2, extra = {}) => ({
  id, type, x, y, width, height, zIndex,
  animationType: 'none', animationDuration: 0.8, animationDelay: 0, animationLoop: false,
  initiallyHidden: false,
  ...extra
});

const text = (id, content, x, y, width, height, extra = {}) => baseElement('text', id, x, y, width, height, extra.zIndex || 3, {
  content, textColor: COLORS.ink, fontSize: 20, fontFamily: 'Inter, sans-serif', fontWeight: '500',
  textAlign: 'left', hasTextBackground: false, hasTextBorder: false, ...extra
});

const block = (id, content, x, y, width, height, extra = {}) => baseElement('block', id, x, y, width, height, extra.zIndex || 2, {
  content, shape: 'rectangle', backgroundColor: COLORS.white, solidColor: COLORS.white, textColor: COLORS.ink,
  fontSize: 18, fontFamily: 'Inter, sans-serif', fontWeight: '600', textAlign: 'left',
  textureImage: '', textureFit: 'cover', ...extra
});

const action = (type, extra = {}) => ({
  type, targetSlideId: '', targetElementId: '', targetTriggerId: '', ruleGroup: '', requireAllButtonsInGroup: false,
  text: 'Novo texto', url: '', textColor: COLORS.ink, backgroundColor: COLORS.white, textAlign: 'left',
  fontFamily: 'Inter, sans-serif', fontWeight: '600', fontSize: 20, hasTextBackground: true, hasTextBorder: false,
  insertX: 120, insertY: 150, insertWidth: 300, insertHeight: 120, moveByX: 140, moveByY: 0,
  moveDuration: 0.8, videoTime: 0, replaceMode: 'replace', replaceText: '', replaceCounterStart: 1,
  replaceCounterStep: 1, detectorAcceptedDrag: 'any', detectorMinMatchCount: 1, detectorTriggerOnce: false,
  quizQuestion: 'Qual alternativa está correta?', quizOptions: ['Opção 1', 'Opção 2', 'Opção 3'],
  quizCorrectOption: 0, successMessage: 'Resposta correta!', errorMessage: 'Tente novamente.',
  actionLabel: 'Validar', quizBackgroundColor: COLORS.white, quizQuestionColor: COLORS.ink,
  quizOptionBackgroundColor: '#eef3f7', quizOptionTextColor: COLORS.ink,
  quizButtonBackgroundColor: COLORS.teal, points: 1, lockOnWrong: false, audioLoop: false,
  ...extra
});

const trigger = (id, name, actionConfig, extra = {}) => ({
  id, name, enabled: true, time: 0, keys: [], visibleKey: false, actionConfig, ...extra
});

const button = (id, label, x, y, width, actionConfig, extra = {}) => {
  const buttonTrigger = trigger(`${id}-trigger`, extra.triggerName || 'Ação 1', actionConfig, extra.trigger || {});
  return baseElement('floatingButton', id, x, y, width, extra.height || 48, extra.zIndex || 6, {
    label, shape: 'rectangle', backgroundColor: extra.backgroundColor || COLORS.teal,
    solidColor: extra.backgroundColor || COLORS.teal, textColor: extra.textColor || COLORS.white,
    fontSize: extra.fontSize || 16, fontFamily: 'Inter, sans-serif', fontWeight: '700',
    shadowEnabled: Boolean(extra.shadowEnabled), shadowColor: extra.shadowColor || COLORS.navy,
    shadowOpacity: 0.25, shadowOffsetY: 8, shadowBlur: 18,
    interactionTriggers: [buttonTrigger], actionConfig: buttonTrigger.actionConfig
  });
};

const card = (id, title, body, x, y, width, height, accent = COLORS.teal) => {
  const compact = height <= 220;
  const titleTop = compact ? 15 : 22;
  const titleHeight = compact ? 38 : 62;
  const bodyTop = compact ? 58 : 94;
  const bodyBottom = compact ? 12 : 18;
  return [
    block(`${id}-shell`, '', x, y, width, height, { backgroundColor: COLORS.white, solidColor: COLORS.white, zIndex: 1 }),
    block(`${id}-accent`, '', x, y, 10, height, { backgroundColor: accent, solidColor: accent, zIndex: 2 }),
    text(`${id}-title`, title, x + 28, y + titleTop, width - 52, titleHeight, { fontSize: compact ? 18 : 21, fontWeight: '800', textColor: accent }),
    text(`${id}-body`, body, x + 28, y + bodyTop, width - 52, height - bodyTop - bodyBottom, { fontSize: compact ? 14 : 17, fontWeight: '500', textColor: COLORS.muted })
  ];
};

const nav = (id, index, total, previousId, nextId) => {
  const items = [text(`${id}-progress`, `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, 570, 660, 140, 40, {
    fontSize: 14, fontWeight: '800', textAlign: 'center', textColor: COLORS.muted
  })];
  if (previousId) items.push(button(`${id}-back`, 'VOLTAR', 48, 652, 150, action('jumpSlide', { targetSlideId: previousId }), { backgroundColor: COLORS.navy }));
  if (nextId) items.push(button(`${id}-next`, index === total ? 'VOLTAR AO ÍNDICE' : 'CONTINUAR', 1032, 652, 200, action('jumpSlide', { targetSlideId: nextId }), { backgroundColor: COLORS.coral }));
  return items;
};

const slides = [];
const shellElements = (id, title, chapter, accent) => [
  block(`${id}-top`, '', 0, 0, 1280, 112, { backgroundColor: COLORS.navy, solidColor: COLORS.navy, zIndex: 1 }),
  text(`${id}-chapter`, chapter.toUpperCase(), 48, 22, 540, 26, { fontSize: 13, fontWeight: '800', textColor: COLORS.yellow }),
  text(`${id}-heading`, title, 48, 50, 1120, 52, { fontSize: 31, fontWeight: '800', textColor: COLORS.white }),
  block(`${id}-marker`, '', 1198, 28, 34, 54, { backgroundColor: accent, solidColor: accent, zIndex: 3 })
];

const pushSlide = ({ id, title, chapter, accent = COLORS.teal, cards = [], elements = [], ...extra }) => {
  const cardElements = cards.flatMap((item, index) => card(
    `${id}-card-${index + 1}`, item.title, item.body,
    48 + index * 402, item.y || 158, item.width || 380, item.height || 438, item.accent || accent
  ));
  slides.push({
    id, title, backgroundFillType: extra.backgroundFillType || 'solid', backgroundColor: extra.backgroundColor || COLORS.paper,
    backgroundGradientStart: extra.backgroundGradientStart || COLORS.paper,
    backgroundGradientEnd: extra.backgroundGradientEnd || COLORS.sky,
    backgroundImage: extra.backgroundImage || '', backgroundVideo: extra.backgroundVideo || '',
    ...(extra.threeDScene ? { threeDScene: extra.threeDScene } : {}),
    elements: [...shellElements(id, title, chapter, accent), ...cardElements, ...elements]
  });
};

pushSlide({
  id: 'tutorial-01-abertura', title: 'Interactive Creator: do primeiro slide à aula publicada', chapter: 'Boas-vindas', accent: COLORS.coral,
  backgroundFillType: 'gradient', backgroundGradientStart: '#eef8f5', backgroundGradientEnd: '#dceef8',
  elements: [
    block('welcome-panel', '', 48, 148, 1184, 460, { backgroundColor: COLORS.white, solidColor: COLORS.white, zIndex: 1 }),
    text('welcome-lead', 'Aprenda fazendo', 92, 190, 560, 64, { fontSize: 42, fontWeight: '800', textColor: COLORS.teal }),
    text('welcome-copy', 'Este tutorial percorre cada área do criador, explica todos os elementos e coloca você para testar quiz, input, arrastar, mídia, gatilhos, animações e navegação.', 92, 270, 560, 150, { fontSize: 22, textColor: COLORS.muted }),
    block('welcome-route', '28 TELAS\n7 CAPÍTULOS\nEXERCÍCIOS REAIS', 760, 205, 360, 250, { backgroundColor: COLORS.mint, solidColor: COLORS.mint, textColor: COLORS.navy, fontSize: 28, fontWeight: '800', textAlign: 'center' }),
    button('welcome-start', 'COMEÇAR O TOUR', 92, 494, 300, action('jumpSlide', { targetSlideId: 'tutorial-02-indice' }), { backgroundColor: COLORS.coral, height: 58, shadowEnabled: true })
  ]
});

pushSlide({
  id: 'tutorial-02-indice', title: 'Escolha um capítulo ou siga a ordem recomendada', chapter: 'Mapa da aula', accent: COLORS.yellow,
  elements: [
    ...card('index-a', '1. Estrutura', 'Interface, módulo, templates, slides, fundos e fluxo de salvamento.', 48, 150, 360, 188, COLORS.teal),
    ...card('index-b', '2. Elementos', 'Texto, bloco, imagem, áudio, vídeo, câmera, quiz, input e desenho.', 460, 150, 360, 188, COLORS.blue),
    ...card('index-c', '3. Interações', 'Botões, teclas, detectores, tempos, vídeo e todas as ações.', 872, 150, 360, 188, COLORS.coral),
    ...card('index-d', '4. Recursos avançados', 'Animações, 3D, IA, segurança, publicação e aula ao vivo.', 254, 374, 360, 188, COLORS.green),
    ...card('index-e', '5. Checklist final', 'Revisão prática antes de entregar uma aula para os alunos.', 666, 374, 360, 188, COLORS.navy),
    button('index-structure', 'ABRIR ESTRUTURA', 94, 280, 266, action('jumpSlide', { targetSlideId: 'tutorial-03-anatomia' }), { backgroundColor: COLORS.teal }),
    button('index-elements', 'ABRIR ELEMENTOS', 506, 280, 266, action('jumpSlide', { targetSlideId: 'tutorial-09-texto' }), { backgroundColor: COLORS.blue }),
    button('index-actions', 'ABRIR INTERAÇÕES', 918, 280, 266, action('jumpSlide', { targetSlideId: 'tutorial-17-gatilhos' }), { backgroundColor: COLORS.coral }),
    button('index-advanced', 'ABRIR AVANÇADO', 300, 504, 266, action('jumpSlide', { targetSlideId: 'tutorial-23-3d' }), { backgroundColor: COLORS.green }),
    button('index-final', 'IR AO CHECKLIST', 712, 504, 266, action('jumpSlide', { targetSlideId: 'tutorial-28-final' }), { backgroundColor: COLORS.navy })
  ]
});

pushSlide({ id: 'tutorial-03-anatomia', title: 'A anatomia do editor', chapter: 'Estrutura', cards: [
  { title: 'Menu lateral', body: 'Navegue por Módulo, Publicados, Estilo, 3D, Elemento, IA e Segurança. O menu pode ser recolhido e também funciona no celular.' },
  { title: 'Palco e dock', body: 'A barra superior cria ferramentas. O palco posiciona os objetos. O dock contextual abre o editor do item selecionado sem deslocar o layout.' },
  { title: 'Camadas e rodapé', body: 'Camadas ordenam frente e fundo. O rodapé renomeia, cria, exclui, limpa, abre a prévia e dá acesso à faixa de slides e aula ao vivo.' }
] });

pushSlide({ id: 'tutorial-04-modulo', title: 'Configure o módulo antes de desenhar', chapter: 'Estrutura', accent: COLORS.blue, cards: [
  { title: 'Identidade', body: 'Escolha o curso, informe título e descrição. A capa pode vir de arquivo local ou URL; aplique, confira o preview e remova quando necessário.' },
  { title: 'Salvar e associar', body: 'Salvar módulo grava os slides e associa ao curso selecionado. Use Criar novo módulo para limpar o editor e iniciar outro trabalho.' },
  { title: 'Boa prática', body: 'Defina nome, objetivo e capa primeiro. Isso reduz módulos sem contexto no portal e ajuda o aluno a reconhecer rapidamente a aula.' }
] });

pushSlide({ id: 'tutorial-05-publicados-templates', title: 'Edite, transporte e reutilize seu trabalho', chapter: 'Estrutura', accent: COLORS.green, cards: [
  { title: 'Publicados', body: 'Em Módulos do curso, selecione um curso, expanda a lista e abra um módulo existente para editar ou excluir com cuidado.' },
  { title: 'Arquivos', body: 'Exportar template gera JSON reutilizável. Importar template carrega outro JSON. Baixar slides gera a apresentação para uso fora do editor.' },
  { title: 'Loja de templates', body: 'A loja mostra preview, categoria, quantidade de slides e resumo. Clique em Usar template, revise o conteúdo e então salve no curso correto.' }
] });

pushSlide({ id: 'tutorial-06-slides-fundos', title: 'Slides, faixa inferior e todos os tipos de fundo', chapter: 'Estrutura', accent: COLORS.coral, cards: [
  { title: 'Operações do slide', body: 'Novo slide adiciona uma tela. Clique no nome para renomear. Excluir remove a tela atual; Limpar mantém o slide e apaga seus elementos.' },
  { title: 'Fundo', body: 'Abra o editor de fundo e escolha cor única, gradiente, imagem por URL/local ou vídeo por URL/local. Aplicar e Limpar controlam o resultado.' },
  { title: 'Lote e navegação', body: 'Ação em lote cria um slide para cada mídia escolhida. Use a faixa inferior para trocar rapidamente e conferir a ordem completa.' }
] });

pushSlide({
  id: 'tutorial-07-palco', title: 'Seleção, movimento, tamanho e camadas', chapter: 'Estrutura', accent: COLORS.yellow,
  elements: [
    ...card('stage-basics', 'Manipulação direta', 'Clique para selecionar. Arraste para mover, use as alças para redimensionar e o controle circular para rotacionar. As setas movem pelo valor configurado em px.', 48, 154, 370, 430, COLORS.yellow),
    ...card('stage-properties', 'Propriedades compartilhadas', 'Largura, altura, rotação, camada, opacidade, cor, fonte, peso, fundo, arrastar pelo aluno e iniciar escondido aparecem conforme o tipo.', 455, 154, 370, 430, COLORS.teal),
    block('stage-draggable', 'ARRASTE-ME', 934, 205, 210, 90, { backgroundColor: COLORS.coral, solidColor: COLORS.coral, textColor: COLORS.white, textAlign: 'center', studentCanDrag: true, zIndex: 5 }),
    block('stage-drop-visual', 'SOLTE AQUI', 925, 390, 230, 125, { backgroundColor: COLORS.mint, solidColor: COLORS.mint, textColor: COLORS.teal, textAlign: 'center', zIndex: 2 }),
    baseElement('detector', 'stage-drop-detector', 925, 390, 230, 125, 4, {
      interactionTriggers: [trigger('stage-drop-trigger', 'Receber peça', action('showElement', { targetElementId: 'stage-drop-success', detectorAcceptedDrag: 'element:stage-draggable', detectorTriggerOnce: true }))],
      actionConfig: action('showElement', { targetElementId: 'stage-drop-success', detectorAcceptedDrag: 'element:stage-draggable', detectorTriggerOnce: true })
    }),
    text('stage-drop-success', 'Perfeito: detector acionado!', 880, 540, 320, 42, { textAlign: 'center', textColor: COLORS.green, fontWeight: '800', initiallyHidden: true })
  ]
});

pushSlide({ id: 'tutorial-08-historico-camadas', title: 'Histórico, área de transferência e ordem visual', chapter: 'Estrutura', cards: [
  { title: 'Desfazer e refazer', body: 'Use os botões da barra ou Ctrl+Z e Ctrl+Y para voltar e reaplicar alterações. Mudanças importantes entram no histórico do editor.' },
  { title: 'Copiar, colar e remover', body: 'Selecione um elemento, copie e cole para duplicar sua configuração. O botão de lixeira remove somente o item selecionado.' },
  { title: 'Camadas', body: 'Use + e - para um nível, setas para frente/fundo total ou arraste diretamente na lista Camadas. Renomeie itens para organizar aulas grandes.' }
] });

pushSlide({ id: 'tutorial-09-texto', title: 'Texto: conteúdo legível e alinhamento previsível', chapter: 'Elementos', accent: COLORS.blue, cards: [
  { title: 'Conteúdo e tipografia', body: 'Edite conteúdo, tamanho, família e peso da fonte. Alinhe o parágrafo à esquerda, centro ou direita e escolha a cor do texto.' },
  { title: 'Caixa do texto', body: 'Ajuste largura e altura. Ative fundo e borda quando precisar de contraste. A cor do bloco é independente da cor global do palco.' },
  { title: 'Alinhamento rápido', body: 'Centralizar no palco move a caixa inteira. Centralizar no bloco alinha o conteúdo dentro da caixa. Não confunda posição com alinhamento.' }
] });

pushSlide({ id: 'tutorial-10-bloco', title: 'Blocos: estrutura, formas, gradientes e textura', chapter: 'Elementos', accent: COLORS.coral, cards: [
  { title: 'Estrutura', body: 'Defina conteúdo, largura, altura, rotação e camada. Formas disponíveis: retângulo, círculo, triângulo e seta.' },
  { title: 'Visual', body: 'Escolha cor única ou gradiente com início e fim. Controle cor do texto, tamanho, fonte e peso sem alterar outros elementos do palco.' },
  { title: 'Textura', body: 'Anexe uma imagem ao bloco, use cover para preencher, contain para mostrar inteira ou fill para esticar. Remover textura volta ao preenchimento.' }
] });

const tutorialSvg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#d9f2ea"/><rect x="55" y="55" width="530" height="250" rx="16" fill="#fff"/><path d="M110 250l110-100 90 70 80-120 140 150" fill="none" stroke="#0f766e" stroke-width="18" stroke-linejoin="round"/><circle cx="470" cy="105" r="35" fill="#f4c95d"/><text x="320" y="330" text-anchor="middle" font-family="Arial" font-size="22" font-weight="700" fill="#17324d">IMAGEM NO PALCO</text></svg>`);
pushSlide({ id: 'tutorial-11-imagem', title: 'Imagem: origem, enquadramento e edição com IA', chapter: 'Elementos', accent: COLORS.green, elements: [
  baseElement('image', 'image-demo', 52, 164, 510, 330, 2, { src: `data:image/svg+xml,${tutorialSvg}`, objectFit: 'contain', backgroundColor: COLORS.white, studentCanDrag: true }),
  ...card('image-source', 'Origem e ajuste', 'Use arquivo local ou URL e clique em Aplicar. Controle largura, altura, rotação e cover, contain ou fill. A opção de arrastar libera a imagem para o aluno.', 610, 164, 570, 180, COLORS.green),
  ...card('image-ai', 'Tratamento', 'Selecionar arquivo substitui a origem. Remover fundo usa o serviço configurado. Em Editar imagem com IA, descreva a mudança e preserve o que deve continuar igual.', 610, 374, 570, 180, COLORS.blue)
] });

const tinyWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
pushSlide({ id: 'tutorial-12-audio', title: 'Áudio: reprodução, coleta do aluno e legendas', chapter: 'Elementos', accent: COLORS.teal, elements: [
  baseElement('audio', 'audio-demo', 72, 180, 440, 84, 4, { src: tinyWav, audioVisible: true, audioLoop: false, collectStudentAudio: false, captionsEnabled: true, captionPosition: 'bottom', captionWidth: 520, captionFontSize: 22, captionTextColor: COLORS.white, captionBackgroundColor: COLORS.navy, captionHighlightColor: COLORS.yellow, captionsUppercase: false, captions: [{ start: 0, end: 1, text: 'Exemplo de trecho legendado' }] }),
  ...card('audio-source', 'Fonte e aparência', 'Escolha arquivo local ou URL, aplique a origem e controle largura, altura e rotação. Loop repete a faixa; Exibir/Recolher controla o player.', 48, 305, 360, 250, COLORS.teal),
  ...card('audio-student', 'Resposta do aluno', 'Recolher áudio do aluno permite gravar uma resposta no módulo. Combine com instrução clara e verifique permissões do navegador.', 460, 305, 360, 250, COLORS.coral),
  ...card('audio-captions', 'Legenda', 'Transcreva com IA ou edite trechos manualmente: início, fim e texto. Ajuste posição, largura, tamanho, cores, destaque e caixa alta.', 872, 305, 360, 250, COLORS.blue)
] });

pushSlide({ id: 'tutorial-13-video', title: 'Vídeo: fontes, legendas, áudio extraído e gatilhos', chapter: 'Elementos', accent: COLORS.blue, elements: [
  baseElement('video', 'video-demo', 48, 154, 520, 292, 3, {
    src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', objectFit: 'cover', captionsEnabled: true,
    captionPosition: 'bottom', captionWidth: 480, captionFontSize: 20, captionTextColor: COLORS.white,
    captionBackgroundColor: COLORS.navy, captionHighlightColor: COLORS.yellow,
    captions: [{ start: 0, end: 2.5, text: 'O vídeo também pode ensinar por etapas.' }],
    videoTriggers: [trigger('video-demo-trigger', 'Tempo 2s', action('showElement', { targetElementId: 'video-trigger-note' }), { time: 2 })]
  }),
  text('video-trigger-note', 'Gatilho de vídeo executado!', 95, 470, 420, 44, { textAlign: 'center', fontWeight: '800', textColor: COLORS.green, initiallyHidden: true }),
  ...card('video-source', 'Origem e IA', 'Use arquivo, URL direta ou YouTube. A IA de mídia transcreve arquivos compatíveis; YouTube incorporado não usa esse fluxo automático.', 610, 154, 570, 150, COLORS.blue),
  ...card('video-captions', 'Legenda e extração', 'Configure trechos, posição, largura, tamanho, cores, destaque e caixa alta. Também é possível extrair o áudio do vídeo como novo elemento.', 610, 326, 570, 150, COLORS.teal),
  ...card('video-triggers', 'Gatilhos no tempo', 'Adicione, duplique, remova e ative gatilhos. Cada tempo pode navegar, inserir, controlar mídia, mostrar, mover, animar, criar quiz ou alternar outro gatilho.', 610, 498, 570, 120, COLORS.coral)
] });

pushSlide({ id: 'tutorial-14-camera', title: 'Câmera: webcam no palco, foto e gravação', chapter: 'Elementos', accent: COLORS.coral, elements: [
  baseElement('camera', 'camera-demo', 54, 164, 520, 390, 3, { backgroundColor: COLORS.navy }),
  ...card('camera-size', 'Enquadramento', 'Selecione o elemento Câmera e ajuste largura, altura e rotação. Posicione antes de iniciar para evitar cobrir conteúdo importante.', 630, 164, 550, 160, COLORS.coral),
  ...card('camera-actions', 'Controles', 'Ativar câmera pede permissão e mostra a webcam. Foto captura um quadro. Gravar inicia o vídeo; Parar encerra câmera ou gravação.', 630, 350, 550, 160, COLORS.teal),
  text('camera-tip', 'No modo ao vivo, use Transmitir Câmera para compartilhar a fonte com os alunos.', 650, 540, 510, 55, { fontSize: 18, textColor: COLORS.muted })
] });

const quizCorrect = trigger('quiz-correct-trigger', 'Ao acertar', action('showElement', { targetElementId: 'quiz-success-extra' }), { quizResult: 'correct' });
const quizWrong = trigger('quiz-wrong-trigger', 'Ao errar', action('playAnimation', { targetElementId: 'quiz-demo' }), { quizResult: 'wrong' });
pushSlide({ id: 'tutorial-15-quiz', title: 'Quiz: configure, responda e reaja ao resultado', chapter: 'Elementos', accent: COLORS.yellow, elements: [
  baseElement('quiz', 'quiz-demo', 48, 158, 610, 420, 3, {
    question: 'Qual recurso executa uma ação quando a resposta está correta?',
    options: ['Camada', 'Gatilho Ao acertar', 'Cor do fundo'], correctOption: 1,
    successMessage: 'Isso! O quiz possui ações por resultado.', errorMessage: 'Observe os botões Ao acertar e Ao errar no editor.',
    actionLabel: 'VALIDAR', quizBackgroundColor: COLORS.white, quizQuestionColor: COLORS.ink,
    quizOptionBackgroundColor: '#eef3f7', quizOptionTextColor: COLORS.ink, quizButtonBackgroundColor: COLORS.teal,
    points: 5, lockOnWrong: false, hideOnCorrect: false, animationType: 'pulse', interactionTriggers: [quizCorrect, quizWrong],
    actionConfig: quizCorrect.actionConfig
  }),
  ...card('quiz-config', 'Campos principais', 'Pergunta, alternativas, resposta correta, mensagens, texto do botão, cores, pontos e bloqueio de nova tentativa quando houver erro.', 700, 158, 480, 190, COLORS.yellow),
  ...card('quiz-actions', 'Ações por resultado', 'Ao acertar e Ao errar possuem gatilhos separados. Você pode revelar feedback, navegar, tocar mídia ou executar qualquer ação compatível.', 700, 374, 480, 150, COLORS.coral),
  text('quiz-success-extra', 'Ação “Ao acertar” executada.', 748, 550, 390, 42, { textAlign: 'center', fontWeight: '800', textColor: COLORS.green, initiallyHidden: true })
] });

const inputAction = action('showElement', { targetElementId: 'input-success-note' });
pushSlide({ id: 'tutorial-16-input', title: 'Input: resposta digitada e anexos do aluno', chapter: 'Elementos', accent: COLORS.green, elements: [
  baseElement('input', 'input-demo', 48, 190, 560, 120, 4, {
    placeholder: 'Digite CRIAR', submitLabel: 'ENVIAR', compareText: 'CRIAR', compareCaseSensitive: false,
    successMessage: 'Resposta aceita.', errorMessage: 'Digite a palavra CRIAR.', allowImage: true, allowAudio: true,
    backgroundColor: COLORS.white, labelColor: COLORS.muted, inputTextColor: COLORS.ink,
    submitButtonColor: COLORS.green, submitButtonTextColor: COLORS.white,
    interactionTriggers: [trigger('input-submit-trigger', 'Envio válido', inputAction)], actionConfig: inputAction
  }),
  text('input-success-note', 'Envio validado e gatilho executado.', 90, 340, 470, 48, { textAlign: 'center', fontWeight: '800', textColor: COLORS.green, initiallyHidden: true }),
  ...card('input-compare', 'Comparação', 'Defina placeholder, botão, texto esperado e se maiúsculas/minúsculas importam. Personalize mensagens de acerto e erro.', 660, 160, 520, 180, COLORS.green),
  ...card('input-files', 'Anexos e estilo', 'Permita anexar imagem e gravar áudio. Ajuste fundo do input, placeholder, texto digitado, botão e cor do texto do botão.', 660, 368, 520, 180, COLORS.blue)
] });

const targetTriggerAction = action('showElement', { targetElementId: 'toggle-result' });
const targetTrigger = trigger('toggle-target-trigger', 'Gatilho de teste', targetTriggerAction);
const controlTrigger = trigger('toggle-control-trigger', 'Liga/desliga', action('toggleTrigger', { targetTriggerId: 'toggle-target-trigger' }));
pushSlide({ id: 'tutorial-17-gatilhos', title: 'Gatilhos: vários comportamentos no mesmo elemento', chapter: 'Interações', accent: COLORS.coral, elements: [
  ...card('trigger-manage', 'Gerenciar', 'Adicionar cria outro gatilho; Duplicar copia a configuração; Remover exclui o selecionado. Cada item pode ser ativado ou desativado.', 48, 154, 350, 220, COLORS.coral),
  ...card('trigger-key', 'Clique e teclado', 'Botões podem responder ao clique e a teclas. O elemento Tecla pode ficar visível ou invisível e aceita combinações configuradas.', 48, 398, 350, 190, COLORS.blue),
  baseElement('floatingButton', 'toggle-control', 470, 190, 300, 62, 6, {
    label: '1. DESATIVAR/ATIVAR TESTE', shape: 'rectangle', backgroundColor: COLORS.coral, solidColor: COLORS.coral,
    textColor: COLORS.white, fontSize: 16, fontWeight: '800', interactionTriggers: [controlTrigger], actionConfig: controlTrigger.actionConfig
  }),
  baseElement('floatingButton', 'toggle-target', 470, 300, 300, 62, 6, {
    label: '2. TESTAR GATILHO', shape: 'rectangle', backgroundColor: COLORS.teal, solidColor: COLORS.teal,
    textColor: COLORS.white, fontSize: 16, fontWeight: '800', interactionTriggers: [targetTrigger], actionConfig: targetTrigger.actionConfig
  }),
  text('toggle-result', 'O gatilho estava ativo!', 465, 402, 310, 54, { textAlign: 'center', fontWeight: '800', textColor: COLORS.green, initiallyHidden: true }),
  ...card('toggle-help', 'Teste a alternância', 'Clique no botão 1: o gatilho do botão 2 para de funcionar. Clique novamente no botão 1: ele volta a funcionar. O alvo é escolhido pelo nome do gatilho.', 830, 184, 350, 320, COLORS.teal),
  baseElement('key', 'trigger-key-demo', 900, 530, 210, 72, 6, {
    shape: 'rectangle', backgroundColor: COLORS.blue, solidColor: COLORS.blue, textColor: COLORS.white,
    fontSize: 16, fontWeight: '800',
    interactionTriggers: [trigger('trigger-key-demo-action', 'Tecla Espaço', action('showElement', { targetElementId: 'toggle-result' }), { keys: ['space'], visibleKey: true })],
    actionConfig: action('showElement', { targetElementId: 'toggle-result' })
  })
] });

pushSlide({ id: 'tutorial-18-acoes-conteudo', title: 'Ações: navegação, inserção e substituição', chapter: 'Interações', accent: COLORS.blue, elements: [
  ...card('actions-nav', 'Navegação', 'Nenhuma ação mantém o gatilho vazio. Próximo slide avança; Ir para slide escolhe um destino; Redirecionar abre uma URL externa.', 48, 154, 360, 200, COLORS.blue),
  ...card('actions-add', 'Adicionar', 'Adicione texto, imagem, áudio, vídeo ou quiz. Configure conteúdo/URL, posição X/Y, largura, altura, estilo e marque a posição diretamente no palco.', 48, 382, 360, 205, COLORS.green),
  text('replace-target', 'Este texto será substituído.', 490, 188, 650, 70, { fontSize: 28, fontWeight: '800', textAlign: 'center', hasTextBackground: true, backgroundColor: COLORS.white }),
  button('replace-demo-btn', 'SUBSTITUIR TEXTO', 490, 290, 300, action('replaceText', { targetElementId: 'replace-target', replaceMode: 'replace', replaceText: 'Texto atualizado pelo gatilho!' }), { backgroundColor: COLORS.blue }),
  button('counter-demo-btn', 'CONTADOR +1', 840, 290, 300, action('replaceText', { targetElementId: 'replace-target', replaceMode: 'counter', replaceCounterStart: 1, replaceCounterStep: 1 }), { backgroundColor: COLORS.coral }),
  button('add-text-demo-btn', 'ADICIONAR TEXTO', 665, 390, 300, action('addText', { text: 'Novo elemento inserido', insertX: 650, insertY: 485, insertWidth: 340, insertHeight: 70, backgroundColor: COLORS.mint, textColor: COLORS.teal, textAlign: 'center' }), { backgroundColor: COLORS.green }),
  text('replace-tip', 'Substituir aceita texto fixo ou contador com valor inicial e incremento.', 515, 575, 600, 40, { fontSize: 17, textAlign: 'center', textColor: COLORS.muted })
] });

pushSlide({ id: 'tutorial-19-acoes-controle', title: 'Ações: visibilidade, movimento, animação e mídia', chapter: 'Interações', accent: COLORS.green, elements: [
  block('control-demo-box', 'ALVO', 515, 205, 180, 110, { backgroundColor: COLORS.yellow, solidColor: COLORS.yellow, textAlign: 'center', zIndex: 4, animationType: 'pulse' }),
  button('control-show', 'MOSTRAR', 48, 190, 180, action('showElement', { targetElementId: 'control-demo-box' }), { backgroundColor: COLORS.green }),
  button('control-hide', 'ESCONDER', 260, 190, 180, action('hideElement', { targetElementId: 'control-demo-box' }), { backgroundColor: COLORS.red }),
  button('control-move', 'MOVER', 48, 275, 180, action('moveElement', { targetElementId: 'control-demo-box', moveByX: 300, moveByY: 120, moveDuration: 0.8 }), { backgroundColor: COLORS.blue }),
  button('control-animate', 'ANIMAR', 260, 275, 180, action('playAnimation', { targetElementId: 'control-demo-box' }), { backgroundColor: COLORS.coral }),
  ...card('media-control', 'Controle de mídia', 'Tocar áudio. Tocar ou pausar vídeo. Ir para um tempo específico do vídeo. Em cada ação, escolha um elemento compatível como alvo.', 820, 155, 360, 190, COLORS.blue),
  ...card('target-picker', 'Escolha do alvo', 'Use a lista de elementos ou o seletor visual no palco. Mostrar/Esconder aceita conteúdo; Mover define X, Y e duração; Animar repete o efeito configurado.', 820, 375, 360, 190, COLORS.green),
  text('control-warning', 'Movimentos respeitam os limites do palco e podem acionar detectores.', 70, 535, 680, 55, { textAlign: 'center', fontWeight: '700', textColor: COLORS.muted })
] });

const groupA = action('showElement', { targetElementId: 'group-result', requireAllButtonsInGroup: true, ruleGroup: 'dupla' });
const groupB = action('showElement', { targetElementId: 'group-result', requireAllButtonsInGroup: true, ruleGroup: 'dupla' });
pushSlide({ id: 'tutorial-20-regras-detector', title: 'Regras de grupo e detector de arrastar', chapter: 'Interações', accent: COLORS.yellow, elements: [
  button('group-button-a', 'ETAPA A', 60, 175, 230, groupA, { backgroundColor: COLORS.blue }),
  button('group-button-b', 'ETAPA B', 320, 175, 230, groupB, { backgroundColor: COLORS.coral }),
  text('group-result', 'Regra completa: os dois botões foram clicados.', 70, 275, 470, 70, { textAlign: 'center', fontWeight: '800', textColor: COLORS.green, initiallyHidden: true }),
  block('detector-piece', 'PEÇA', 720, 175, 160, 90, { backgroundColor: COLORS.coral, solidColor: COLORS.coral, textColor: COLORS.white, textAlign: 'center', studentCanDrag: true, zIndex: 5 }),
  block('detector-zone', 'DESTINO', 945, 340, 220, 130, { backgroundColor: COLORS.mint, solidColor: COLORS.mint, textColor: COLORS.teal, textAlign: 'center', zIndex: 2 }),
  baseElement('detector', 'detector-demo', 945, 340, 220, 130, 4, {
    interactionTriggers: [trigger('detector-demo-trigger', 'Soltar peça', action('showElement', { targetElementId: 'detector-result', detectorAcceptedDrag: 'element:detector-piece', detectorMinMatchCount: 1, detectorTriggerOnce: true }))],
    actionConfig: action('showElement', { targetElementId: 'detector-result', detectorAcceptedDrag: 'element:detector-piece', detectorMinMatchCount: 1, detectorTriggerOnce: true })
  }),
  text('detector-result', 'Encaixe detectado!', 900, 500, 300, 45, { textAlign: 'center', fontWeight: '800', textColor: COLORS.green, initiallyHidden: true }),
  text('group-help', 'Regra: dê o mesmo nome e ative “só executar depois de clicar em todos”.', 60, 400, 500, 100, { fontSize: 18, textColor: COLORS.muted }),
  text('detector-help', 'Detector aceita qualquer item, um tipo ou um elemento específico; também define quantidade mínima e disparo único.', 665, 570, 540, 55, { fontSize: 17, textAlign: 'center', textColor: COLORS.muted })
] });

const timedAction = action('showElement', { targetElementId: 'timed-reveal' });
pushSlide({ id: 'tutorial-21-tempo-video', title: 'Gatilhos por tempo e gatilhos de vídeo', chapter: 'Interações', accent: COLORS.coral, elements: [
  baseElement('timedTrigger', 'timed-demo', 40, 130, 120, 50, 1, { interactionTriggers: [trigger('timed-demo-trigger', 'Após 2 segundos', timedAction, { time: 2 })], actionConfig: timedAction }),
  text('timed-reveal', 'Apareci após 2 segundos.', 120, 190, 520, 90, { fontSize: 34, fontWeight: '800', textAlign: 'center', textColor: COLORS.coral, hasTextBackground: true, backgroundColor: COLORS.white, initiallyHidden: true }),
  ...card('timed-card', 'Gatilho por tempo', 'O elemento é invisível para o aluno. Defina o segundo e a ação. Vários gatilhos podem criar uma sequência automática no mesmo slide.', 48, 350, 560, 190, COLORS.coral),
  ...card('video-time-card', 'Gatilho do vídeo', 'Cada gatilho pertence a um vídeo e dispara ao alcançar o tempo. Além das ações comuns, pode pausar, buscar tempo, tocar a origem ao validar e esconder quiz no acerto.', 660, 165, 520, 375, COLORS.blue)
] });

const penPoints = [{ x: 0.02, y: 0.72 }, { x: 0.18, y: 0.45 }, { x: 0.34, y: 0.62 }, null, { x: 0.45, y: 0.52 }, { x: 0.62, y: 0.25 }, { x: 0.82, y: 0.42 }, { x: 0.97, y: 0.08 }];
pushSlide({ id: 'tutorial-22-desenho-animacao', title: 'Caneta, borracha, pincel mágico e animações', chapter: 'Criação visual', accent: COLORS.blue, elements: [
  baseElement('pen', 'pen-demo', 55, 170, 500, 240, 4, { points: penPoints, strokeColor: COLORS.blue, strokeWidth: 12, studentCanPaint: true, backgroundColor: 'transparent' }),
  baseElement('animatedArrow', 'arrow-demo', 435, 400, 170, 70, 5, { label: '➜', textColor: COLORS.coral, backgroundColor: 'transparent' }),
  ...card('pen-card', 'Caneta e pincel mágico', 'Escolha cor, espessura pelo slider ou número e permita desenho do aluno. Desenhe no palco; o pincel mágico usa o traço como referência para gerar imagem ou elemento funcional.', 640, 150, 540, 180, COLORS.blue),
  ...card('eraser-card', 'Borracha', 'Selecione imagem, bloco ou traço. Use modo pincel ou laço, formato e escopo; ajuste tamanho exato. Restaurar desfaz a máscara e Aplicar confirma.', 640, 355, 540, 150, COLORS.coral),
  ...card('animation-card', 'Animação', 'Selecione texto, bloco, botão, imagem, câmera ou tecla. Escolha efeito, duração, atraso e loop. Em quadros, adicione poses e reproduza o movimento gravado.', 640, 530, 540, 95, COLORS.green)
] });

pushSlide({ id: 'tutorial-23-3d', title: 'Palco 3D: objeto, biblioteca e elementos fixados', chapter: 'Recursos avançados', accent: COLORS.green,
  threeDScene: { schemaVersion: 1, enabled: true, assetId: '', primitiveType: 'sphere', controlMode: 'student', quaternion: [0, 0, 0, 1], position: [-0.2, 0], zoom: 0.9, animationIndex: -1, animationPlaying: false, animationSpeed: 1 },
  elements: [
    text('three-d-overlay', 'ELEMENTO FIXADO NO 3D', 710, 220, 360, 90, { fontSize: 26, fontWeight: '800', textAlign: 'center', textColor: COLORS.white, hasTextBackground: true, backgroundColor: COLORS.teal,
      attachment3d: { enabled: true, position: [1.7, 0.5, 0.2], normal: [0, 0, 1], surfaceSize: [2.7, 1.1], scale: 1, surfaceOffset: 0.02, fallback2d: { x: 710, y: 220 } } }),
    ...card('three-d-start', 'Ativar e escolher', 'Ative por slide. Pesquise o catálogo e filtre categoria, use cubo/esfera/cilindro/plano/pirâmide ou importe GLB/GLTF. Importações novas consomem créditos.', 48, 150, 350, 200, COLORS.green),
    ...card('three-d-library', 'Biblioteca e controle', 'Selecione um modelo salvo, veja estatísticas ou exclua da biblioteca. Defina se somente professor ou também aluno pode girar e explorar.', 48, 380, 350, 190, COLORS.blue),
    ...card('three-d-position', 'Posição e animação', 'Mova horizontal/vertical, centralize, reproduza ou pause animações do modelo e redefina rotação. Fixe elementos 2D na superfície, reposicione ou desfixe.', 850, 400, 350, 190, COLORS.coral)
  ]
});

pushSlide({ id: 'tutorial-24-ia', title: 'Assistente de IA: planeje, revise e aplique', chapter: 'Recursos avançados', accent: COLORS.coral, cards: [
  { title: 'Pedido e contexto', body: 'Descreva exatamente o que criar ou alterar. A IA considera slide e elemento selecionados. Anexe uma imagem quando ela for referência visual ou conteúdo.' },
  { title: 'Fluxo seguro', body: 'Gerar proposta produz plano e ações. Leia o feedback, confira os alvos e clique Aplicar ações. Descartar remove a proposta sem alterar o palco.' },
  { title: 'Créditos e precisão', body: 'Imagens, mídia e 3D podem consumir créditos. Para editar, diga “altere o elemento atual” e informe propriedade e valor; evite frases ambíguas.' }
] });

pushSlide({ id: 'tutorial-25-seguranca', title: 'Segurança, progresso e acesso público', chapter: 'Publicação', accent: COLORS.red, cards: [
  { title: 'Progresso', body: 'Travar próximo módulo exige concluir o atual. Exigir quiz obriga responder os quizzes antes da conclusão. Teste ambos na prévia do aluno.' },
  { title: 'Compartilhamento', body: 'Link público permite acesso compartilhável após salvar. Copie ou abra o link gerado. Permitir caneta libera desenho do aluno durante o módulo.' },
  { title: 'Reconhecimento facial', body: 'Ative a verificação e escolha entrada, durante o módulo e conclusão. Use somente quando necessário e respeite consentimento e política de dados.' }
] });

pushSlide({ id: 'tutorial-26-ao-vivo', title: 'Aula ao vivo: publique o palco em tempo real', chapter: 'Publicação', accent: COLORS.blue, cards: [
  { title: 'Iniciar e compartilhar', body: 'Iniciar ao vivo gera uma sessão e um link. Copie ou abra para testar a visão do aluno. Encerrar interrompe o compartilhamento.' },
  { title: 'Publicação', body: 'No modo automático, alterações são enviadas. Em Publicação manual, use Publicar agora para controlar quando os alunos recebem a nova versão.' },
  { title: 'Presença', body: 'Transmita câmera ou tela quando disponível. Liberar cursores mostra apontamentos dos alunos. A caneta ao vivo depende da permissão configurada.' }
] });

pushSlide({ id: 'tutorial-27-fluxo-final', title: 'Prévia, revisão e salvamento sem sustos', chapter: 'Publicação', accent: COLORS.green, cards: [
  { title: 'Prévia do aluno', body: 'Execute a aula desde o início. Teste navegação, quiz, input, arrastar, tempos, mídia, teclado, elementos escondidos e conclusão.' },
  { title: 'Revisão', body: 'Confira contraste, texto dentro das caixas, camadas, nomes, destinos dos gatilhos, mídias, links, mobile e se o próximo slide fica visível.' },
  { title: 'Entrega', body: 'Salve no curso correto, defina segurança e link público, reabra o módulo publicado e faça uma segunda prévia. Exporte o JSON como cópia reutilizável.' }
] });

const finalCorrect = trigger('final-correct-trigger', 'Ao acertar', action('showElement', { targetElementId: 'final-complete' }), { quizResult: 'correct' });
const finalWrong = trigger('final-wrong-trigger', 'Ao errar', action('playAnimation', { targetElementId: 'final-quiz' }), { quizResult: 'wrong' });
pushSlide({ id: 'tutorial-28-final', title: 'Checklist final: você está pronto para criar', chapter: 'Conclusão', accent: COLORS.yellow, elements: [
  baseElement('quiz', 'final-quiz', 48, 150, 600, 420, 3, {
    question: 'Qual é a melhor última etapa antes de publicar?',
    options: ['Salvar sem testar', 'Executar a prévia completa como aluno', 'Excluir os gatilhos'], correctOption: 1,
    successMessage: 'Perfeito. Uma aula interativa precisa ser vivida antes de ser entregue.',
    errorMessage: 'A prévia completa encontra problemas que o modo de edição não mostra.', actionLabel: 'CONCLUIR',
    quizBackgroundColor: COLORS.white, quizQuestionColor: COLORS.ink, quizOptionBackgroundColor: '#eef3f7',
    quizOptionTextColor: COLORS.ink, quizButtonBackgroundColor: COLORS.green, points: 10, lockOnWrong: false,
    animationType: 'pulse', interactionTriggers: [finalCorrect, finalWrong], actionConfig: finalCorrect.actionConfig
  }),
  ...card('final-list', 'Antes de entregar', 'Objetivo claro\nConteúdo legível\nInterações testadas\nMídia funcionando\nGatilhos com alvo válido\nSegurança definida\nPrévia concluída', 710, 150, 470, 350, COLORS.yellow),
  text('final-complete', 'TUTORIAL CONCLUÍDO', 760, 535, 370, 58, { fontSize: 28, fontWeight: '800', textAlign: 'center', textColor: COLORS.green, initiallyHidden: true })
] });

const total = slides.length;
slides.forEach((slide, index) => {
  const previousId = index > 0 ? slides[index - 1].id : '';
  const nextId = index < total - 1 ? slides[index + 1].id : 'tutorial-02-indice';
  if (slide.id !== 'tutorial-01-abertura' && slide.id !== 'tutorial-02-indice') {
    slide.elements.push(...nav(slide.id, index + 1, total, previousId, nextId));
  }
});

const payload = {
  kind: 'curso-slide-template', version: 1, exportedAt: new Date().toISOString(), source: 'interactive-creator',
  store: {
    category: 'Tutorial da plataforma', badge: 'Interativo',
    summary: 'Tutorial completo em 28 telas sobre módulo, palco, todos os elementos, gatilhos, mídia, desenho, 3D, IA, segurança, publicação e aula ao vivo.',
    accentColor: COLORS.teal
  },
  template: {
    title: 'Tutorial Completo do Interactive Creator',
    description: 'Aula interativa para dominar todas as áreas e ferramentas do criador, com índice navegável, exemplos e exercícios funcionais.',
    builderData: {
      slides, stageSize: STAGE,
      moduleSettings: {
        lockNextModuleUntilCompleted: false, requireQuizCompletion: true, isPublic: false, coverImage: '',
        allowStudentPen: true, allowLiveCursors: true,
        faceVerification: { enabled: false, verifyOnEntry: true, verifyDuringModule: false, verifyOnCompletion: false, schemaVersion: 1 }
      },
      tutorialCoverage: coverage
    }
  }
};

const assertTemplate = () => {
  if (slides.length !== 28) throw new Error(`Esperava 28 slides, recebeu ${slides.length}.`);
  const slideIds = new Set();
  const elementIds = new Set();
  const triggerIds = new Set();
  slides.forEach((slide) => {
    if (slideIds.has(slide.id)) throw new Error(`Slide duplicado: ${slide.id}`);
    slideIds.add(slide.id);
    (slide.elements || []).forEach((element) => {
      if (elementIds.has(element.id)) throw new Error(`Elemento duplicado: ${element.id}`);
      elementIds.add(element.id);
      if (element.x < 0 || element.y < 0 || element.x + element.width > STAGE.width || element.y + element.height > STAGE.height) {
        throw new Error(`Elemento fora do palco: ${element.id}`);
      }
      [...(element.interactionTriggers || []), ...(element.videoTriggers || [])].forEach((item) => {
        if (triggerIds.has(item.id)) throw new Error(`Gatilho duplicado: ${item.id}`);
        triggerIds.add(item.id);
      });
    });
  });
  slides.forEach((slide) => (slide.elements || []).forEach((element) => {
    [...(element.interactionTriggers || []), ...(element.videoTriggers || [])].forEach((item) => {
      const config = item.actionConfig || {};
      if (config.targetSlideId && !slideIds.has(config.targetSlideId)) throw new Error(`Slide alvo ausente: ${config.targetSlideId}`);
      if (config.targetElementId && !elementIds.has(config.targetElementId)) throw new Error(`Elemento alvo ausente: ${config.targetElementId}`);
      if (config.targetTriggerId && !triggerIds.has(config.targetTriggerId)) throw new Error(`Gatilho alvo ausente: ${config.targetTriggerId}`);
    });
  }));
  if (new Set(coverage).size !== coverage.length) throw new Error('Cobertura contém itens duplicados.');
};

assertTemplate();
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Tutorial criado: ${OUTPUT_PATH}`);
console.log(`${slides.length} slides, ${slides.reduce((sum, slide) => sum + slide.elements.length, 0)} elementos, ${coverage.length} itens de cobertura.`);
