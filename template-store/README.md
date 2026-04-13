Loja interna de templates do editor.

Como funciona:
- Coloque aqui arquivos `.json` individuais, um template por arquivo.
- Cada arquivo aparece automaticamente na loja de templates do `interactive-creator`.
- Apenas quem tem acesso ao codigo do projeto consegue publicar novos itens aqui.

Formato recomendado:
- Use o mesmo JSON exportado pelo botao `Exportar template` do editor.
- Opcionalmente, adicione um bloco `store` na raiz para melhorar a exibicao na loja.

Exemplo de metadados opcionais:
```json
{
  "store": {
    "category": "Abertura",
    "badge": "Novo",
    "summary": "Template com hero, cards e CTA.",
    "accentColor": "#6d63ff"
  }
}
```

Sugestao:
- Use nomes de arquivo simples, como `abertura-gradiente.json`, `slide-quiz-produto.json` e `oferta-video.json`.
