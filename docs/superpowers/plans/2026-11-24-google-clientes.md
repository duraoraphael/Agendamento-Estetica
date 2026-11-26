# Login Google para clientes

> Implementação em sequência com testes de regressão no PostgreSQL descartável.

O NextAuth continua emitindo a sessão da aplicação. O trabalho inclui as duas telas de entrada, vínculo de clientes existentes em Minha conta, complemento de cadastro e retorno ao agendamento. O vínculo exige sessão válida da conta existente, pois o cadastro por senha aceita endereços ainda sem verificação. O login Google Agenda continua com seu próprio cliente OAuth.

- [x] Testar a resolução da identidade Google e a conclusão do cadastro. Cobrir e-mail verificado, bloqueio de administradores, vínculo com sessão válida, WhatsApp, consentimento e repetição do cadastro.
- [x] Acrescentar `User.googleSubject` único e permitir `passwordHash` nulo. O cadastro Google só cria a conta depois da validação do formulário. A intenção de cadastro fica em cookie temporário criptografado e separado da sessão.
- [x] Conectar o provedor Google e o formulário de conclusão ao NextAuth. Usar o ID interno e a versão do banco na sessão e preservar caminhos internos de agendamento.
- [x] Inserir os botões em login, cadastro e Minha conta e documentar a configuração.
- [x] Executar a suíte, a checagem de tipos e a compilação. Foram aprovados 428 testes da suíte e 8 verificações no navegador com identidade Google simulada.
