# Projeto de automação de front

> Leia tudo antes de executar o projeto, please.

### Configurar para usar novos projetos

- Dentro de `playground/applications` você vai encontrar os projetos usados para visualização do Front.<br>Para criar novos projetos basta criar uma nova pasta, com qualquer nome e na raiz dessa pasta criar um arquivo chamado `environments.json`, conforme exemplo já existente.

- Dentro de `playground/frontend/script.js` exatamente da linha 9 a 12, existem usuários que tem permissão para visualizar projetos de acordo com seu gosto.<br>Você pode criar novos usuários e dar permissões.

- Dentro de `playground/applications/project-a/login/login.json`, estão os cenários que serão executados pelo front, lembrando que, você pode alterar o nome da pasta, da subpasta, do arquivo .json de acordo com seu gosto.<br>
  **MAS** ao altera-los sempre de ir em `playground/frontend/script.js` e dar a permissão ao novo projeto.

- _npm run test_ vai executar o backend _altamente necessário para o funcionamento_, em seguida no .html do front clique com botão direito e em seguida, _Open Live Server_ (Extensão do vscode)

- Lembre-se sempre de criar o projeto no `tests` para que o caminho apontado no arquivo dentro da pasta do projeto funcione.

- Abaixo a estrutura de como criar o json com os cenários

```json
[
  {
    "id": "login",
    "name": "Acessando Login",
    "file": "tests/project_a/login.spec.ts"
  },
  {
    "id": "cadastro",
    "name": "Cadastro com sucesso",
    "file": "tests/project_a/login.spec.ts"
  }
]

```
- No `server.js` em `playground/backend/server.js` na linha 246, 247 estão definidos a ENV e a BASE_URL de acordo com o ambiente. Isso reflete no `page.goto` usado no teste.