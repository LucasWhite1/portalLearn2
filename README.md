# Sistema de Ensino e Progresso

Aplicação full stack com:
- API em Express + PostgreSQL para autenticação, alunos, cursos, notificações e progresso.
- Frontend estático em HTML/CSS/JS para login, portal do aluno, painel admin e criador de aulas.
- Catálogo local de templates em `template-store/`.

## Estrutura
- `backend/`: API Node.js e migrações do banco.
- `frontend/`: arquivos estáticos da interface.
- `template-store/`: templates JSON usados pelo criador de aulas.

## Executar localmente
1. Copie `backend/.env.example` para `backend/.env` e preencha seus dados.
2. Instale as dependências:
   ```bash
   cd backend
   npm install
   ```
3. Rode a migração:
   ```bash
   psql -d sua_base -f migrations/001_schema.sql
   ```
4. Inicie a aplicação:
   ```bash
   npm run dev
   ```
5. Abra `http://localhost:4000/`.

## Docker
O projeto inclui `Dockerfile` e `docker-compose.yml` para subir a aplicação em um único container.

Build manual:
```bash
docker build -t curso-platform .
docker run --env-file backend/.env -p 4000:4000 curso-platform
```

Com Compose:
```bash
docker compose up --build -d
```

## Deploy no EasyPanel
- Crie o serviço usando este repositório GitHub.
- Aponte o build para o `Dockerfile` na raiz.
- Configure as variáveis de ambiente com base em `backend/.env.example`.
- Garanta que o PostgreSQL esteja acessível pelo container.
- Execute a migração `backend/migrations/001_schema.sql` no banco de produção antes de usar o sistema.

## Observações de segurança
- Não publique `backend/.env` no GitHub.
- Troque todas as senhas e segredos antes de produção.
- Se houver credenciais antigas já usadas localmente, considere rotacioná-las antes do deploy.