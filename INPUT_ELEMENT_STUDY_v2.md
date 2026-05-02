# Estudo: Elemento Input no Criador Interativo - v2.0

## 📋 Visão Geral

O elemento **Input** é um componente interativo que permite aos alunos responder perguntas digitando texto, enviando imagens ou gravando áudio. É um dos elementos flutuantes disponíveis na ferramenta de criação de aulas interativas, **agora com suporte completo de personalização de cores!**

---

## 🎯 Características Estruturais

### Tipo de Elemento
- **type**: `'input'`
- **Categoria**: Elemento Flutuante (Floating Button)
- **Localização no Código**: 
  - HTML: `interactive-creator.html` (linhas 373, 773-842)
  - JavaScript: `interactive-creator.js` (funções várias)

### Dimensões Padrão
```javascript
const defaultHeight = element.compareImageEnabled && element.compareImageReference ? 190 : 88;
const minHeight = element.compareImageEnabled && element.compareImageReference ? 150 : 76;
element.width = Math.max(260, Number(element.width) || 360);  // Mínimo 260px
element.height = Math.max(minHeight, Number(element.height) || defaultHeight);
```

---

## 🔧 Propriedades Configuráveis

### 1. **Texto e Labels**
| Propriedade | Padrão | Descrição |
|---|---|---|
| `placeholder` | "Digite sua resposta" | Texto auxiliar no campo |
| `submitLabel` | "Enviar resposta" | Texto do botão de envio |
| `successMessage` | "Resposta enviada com sucesso." | Mensagem ao acertar |
| `errorMessage` | "A palavra não confere..." | Mensagem de erro |

### 2. **Validação de Texto**
| Propriedade | Tipo | Descrição |
|---|---|---|
| `compareText` | string | Texto esperado (vazio = qualquer texto aceito) |
| `compareCaseSensitive` | boolean | Diferenciar maiúsculas/minúsculas |

### 3. **Validação por Imagem**
| Propriedade | Tipo | Descrição |
|---|---|---|
| `compareImageEnabled` | boolean | Ativa comparação de imagens via IA |
| `compareImageReference` | string | URL da imagem de referência |

### 4. **Tipos de Entrada**
| Propriedade | Tipo | Descrição |
|---|---|---|
| `allowImage` | boolean | Permite anexar imagem |
| `allowAudio` | boolean | Permite gravar áudio |

### 5. **Personalização de Cores** ✨ **NOVO!**
| Propriedade | Padrão | Descrição |
|---|---|---|
| `backgroundColor` | "#ffffff" | Fundo do campo de texto |
| `labelColor` | "#9ca3af" | Cor do placeholder |
| `inputTextColor` | "#0f142c" | Cor do texto digitado |
| `submitButtonColor` | "#6d63ff" | Fundo do botão de envio |
| `submitButtonTextColor` | "#ffffff" | Cor do texto do botão |

---

## 🎨 Campos de Edição - Cores ✨ **NOVO!**

```html
<!-- Fundo do Input -->
<div id="floatingInputBackgroundColorField" class="builder-field hidden">
  <label for="floatingInputBackgroundColorInput">Fundo do input</label>
  <input id="floatingInputBackgroundColorInput" type="color" value="#ffffff" />
</div>

<!-- Cor do Placeholder -->
<div id="floatingInputLabelColorField" class="builder-field hidden">
  <label for="floatingInputLabelColorInput">Cor do placeholder</label>
  <input id="floatingInputLabelColorInput" type="color" value="#9ca3af" />
</div>

<!-- Cor do Texto Digitado -->
<div id="floatingInputTextColorField" class="builder-field hidden">
  <label for="floatingInputTextColorInput">Cor do texto digitado</label>
  <input id="floatingInputTextColorInput" type="color" value="#0f142c" />
</div>

<!-- Fundo do Botão -->
<div id="floatingInputButtonBackgroundColorField" class="builder-field hidden">
  <label for="floatingInputButtonBackgroundColorInput">Fundo do botão de envio</label>
  <input id="floatingInputButtonBackgroundColorInput" type="color" value="#6d63ff" />
</div>

<!-- Cor do Texto do Botão -->
<div id="floatingInputButtonTextColorField" class="builder-field hidden">
  <label for="floatingInputButtonTextColorInput">Cor do texto do botão</label>
  <input id="floatingInputButtonTextColorInput" type="color" value="#ffffff" />
</div>
```

---

## 📊 Estrutura de Objeto Completa - v2.0

```javascript
{
  type: 'input',
  id: 'element-uuid-123',
  x: 100,
  y: 150,
  width: 360,
  height: 88,
  zIndex: 10,
  
  // Configuração de Texto
  placeholder: 'Digite sua resposta',
  submitLabel: 'Enviar resposta',
  
  // Validação
  compareText: 'elevador',
  compareCaseSensitive: false,
  compareImageEnabled: false,
  compareImageReference: '',
  
  // Mensagens
  successMessage: 'Resposta enviada com sucesso.',
  errorMessage: 'A palavra não confere. Tente novamente.',
  
  // Mídias
  allowImage: true,
  allowAudio: false,
  
  // ✨ Personalização de Cores (NOVO!)
  backgroundColor: '#ffffff',
  labelColor: '#9ca3af',
  inputTextColor: '#0f142c',
  submitButtonColor: '#6d63ff',
  submitButtonTextColor: '#ffffff',
  
  // Gatilhos/Ações
  triggers: [
    {
      id: 'trigger-001',
      action: 'showElement',
      target: 'element-uuid-456'
    }
  ]
}
```

---

## 🎯 Exemplos de Personalização ✨

### Exemplo 1: Tema Verde
```javascript
{
  type: 'input',
  placeholder: 'Digite a resposta',
  compareText: 'sustentabilidade',
  backgroundColor: '#e8f5e9',
  labelColor: '#558b2f',
  inputTextColor: '#1b5e20',
  submitButtonColor: '#2e7d32',
  submitButtonTextColor: '#ffffff'
}
```

### Exemplo 2: Tema Azul Premium
```javascript
{
  type: 'input',
  backgroundColor: '#f5f7fa',
  labelColor: '#687c9f',
  inputTextColor: '#1e3a8a',
  submitButtonColor: '#1e40af',
  submitButtonTextColor: '#ffffff'
}
```

### Exemplo 3: Tema Quente (Laranja)
```javascript
{
  type: 'input',
  backgroundColor: '#fff7ed',
  labelColor: '#d97706',
  inputTextColor: '#92400e',
  submitButtonColor: '#ea580c',
  submitButtonTextColor: '#ffffff'
}
```

---

## 🔄 Normalização dos Dados - v2.0

```javascript
const normalizeInputElement = (element) => {
  if (!element || element.type !== 'input') return;
  
  // Texto
  element.placeholder = typeof element.placeholder === 'string' && element.placeholder 
    ? element.placeholder 
    : 'Digite sua resposta';
  
  element.submitLabel = typeof element.submitLabel === 'string' && element.submitLabel 
    ? element.submitLabel 
    : 'Enviar resposta';
  
  // Validação
  element.compareText = typeof element.compareText === 'string' 
    ? element.compareText 
    : '';
  
  element.compareCaseSensitive = Boolean(element.compareCaseSensitive);
  element.compareImageEnabled = Boolean(element.compareImageEnabled);
  element.compareImageReference = typeof element.compareImageReference === 'string' 
    ? element.compareImageReference 
    : '';
  
  // Mensagens
  element.successMessage = typeof element.successMessage === 'string' && element.successMessage 
    ? element.successMessage 
    : 'Resposta enviada com sucesso.';
  
  element.errorMessage = typeof element.errorMessage === 'string' && element.errorMessage 
    ? element.errorMessage 
    : 'A palavra não confere. Tente novamente.';
  
  // Mídias
  element.allowImage = typeof element.allowImage === 'boolean' 
    ? element.allowImage 
    : true;
  
  if (element.compareImageEnabled) {
    element.allowImage = true;
  }
  
  element.allowAudio = Boolean(element.allowAudio);
  
  // ✨ Cores (NOVO!)
  element.backgroundColor = typeof element.backgroundColor === 'string' 
    ? element.backgroundColor 
    : '#ffffff';
  
  element.labelColor = typeof element.labelColor === 'string' 
    ? element.labelColor 
    : '#9ca3af';
  
  element.inputTextColor = typeof element.inputTextColor === 'string' 
    ? element.inputTextColor 
    : '#0f142c';
  
  element.submitButtonColor = typeof element.submitButtonColor === 'string' 
    ? element.submitButtonColor 
    : '#6d63ff';
  
  element.submitButtonTextColor = typeof element.submitButtonTextColor === 'string' 
    ? element.submitButtonTextColor 
    : '#ffffff';
  
  // Dimensões
  const defaultHeight = element.compareImageEnabled && element.compareImageReference ? 190 : 88;
  const minHeight = element.compareImageEnabled && element.compareImageReference ? 150 : 76;
  element.width = Math.max(260, Number(element.width) || 360);
  element.height = Math.max(minHeight, Number(element.height) || defaultHeight);
};
```

---

## 🛠️ Renderização com Cores ✨

```javascript
const inputBgColor = element.backgroundColor || '#ffffff';
const inputTextColor = element.inputTextColor || '#0f142c';
const buttonBgColor = element.submitButtonColor || '#6d63ff';
const buttonTextColor = element.submitButtonTextColor || '#ffffff';

const textFieldMarkup = `
  <textarea 
    class="builder-input-text" 
    style="background-color: ${inputBgColor}; color: ${inputTextColor};"
    placeholder="${escapeHtml(element.placeholder || 'Digite sua resposta')}"
  ></textarea>
`;

const buttonMarkup = `
  <button 
    type="button" 
    class="primary-btn builder-input-submit"
    style="background-color: ${buttonBgColor}; color: ${buttonTextColor};"
  >
    <span class="builder-input-submit-icon" aria-hidden="true">➤</span>
  </button>
`;
```

---

## 📝 Variáveis Globais Adicionadas

```javascript
// Declarações no topo do arquivo
let floatingInputBackgroundColorInput;
let floatingInputLabelColorInput;
let floatingInputTextColorInput;
let floatingInputButtonBackgroundColorInput;
let floatingInputButtonTextColorInput;

// Inicialização em initDOMCaches()
floatingInputBackgroundColorInput = document.getElementById('floatingInputBackgroundColorInput');
floatingInputLabelColorInput = document.getElementById('floatingInputLabelColorInput');
floatingInputTextColorInput = document.getElementById('floatingInputTextColorInput');
floatingInputButtonBackgroundColorInput = document.getElementById('floatingInputButtonBackgroundColorInput');
floatingInputButtonTextColorInput = document.getElementById('floatingInputButtonTextColorInput');

// Integração no listeners array
floatingInputBackgroundColorInput,
floatingInputLabelColorInput,
floatingInputTextColorInput,
floatingInputButtonBackgroundColorInput,
floatingInputButtonTextColorInput,
```

---

## ✨ Mudanças Implementadas - 22/04/2026

### ✅ Completo
- [x] 5 campos de cor adicionados ao HTML
- [x] 5 variáveis globais declaradas
- [x] 5 elementos DOM inicializados
- [x] Sincronização de valores ao selecionar elemento
- [x] Salvamento de valores quando alterados
- [x] Normalização com valores padrão
- [x] Aplicação inline das cores na renderização
- [x] Integração com sistema de listeners
- [x] Compatibilidade com sistema de triggers

### Campos Adicionados
1. `floatingInputBackgroundColorInput` - Fundo do input
2. `floatingInputLabelColorInput` - Cor do placeholder
3. `floatingInputTextColorInput` - Cor do texto
4. `floatingInputButtonBackgroundColorInput` - Fundo do botão
5. `floatingInputButtonTextColorInput` - Cor do texto do botão

---

## 📝 Notas Importantes

1. **Cores Inline**: Aplicadas direto no HTML com `style` attribute
2. **Padrões Sensatos**: Cada cor tem um default que funciona bem visualmente
3. **Case Sensitive**: Descrição dos campos em português PT-BR
4. **Compatível com Triggers**: Cores persistem com gatilhos/ações
5. **Sem Impacto Visual**: Campos ocultos até seleção do elemento input
6. **Sincronização Dupla**: Valores síncronizam bidirecionalalmente

---

## 🔗 Referências de Código - v2.0

### HTML
- **Campos de cores**: interactive-creator.html (linhas 827-842)
- **Botão input**: interactive-creator.html (linha 373)

### JavaScript Core Functions
- **normalizeInputElement()**: Validação e padrões
- **renderElementFloatingInputForm()**: Sincronização de valores
- **syncFloatingElementInputState()**: Salvamento de valores
- **createInputElementNode()**: Renderização com cores
- **initDOMCaches()**: Inicialização de variáveis

### Event Listeners Array
- Localizado em: interactive-creator.js (linha ~10572)
- 5 novos campos adicionados à lista de listeners

---

## 🎨 Design System de Cores Padrão

| Elemento | Cor | Hex | Descrição |
|---|---|---|---|
| Fundo | Branco | #ffffff | Contraste máximo |
| Placeholder | Cinza | #9ca3af | Suave e legível |
| Texto | Escuro | #0f142c | Alta legibilidade |
| Botão | Roxo | #6d63ff | Destaque visual |
| Texto do Botão | Branco | #ffffff | Contraste total |

---

## 🚀 Próximas Evoluções Possíveis

- [ ] Presets de temas (Verde, Azul, Laranja, etc.)
- [ ] Sincronização de cores com fundo do slide
- [ ] Animação de cores ao validar resposta
- [ ] Paleta de cores personalizada por curso
- [ ] Modo dark/light automático
