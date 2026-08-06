# Diretrizes de Segurança e Proteção de Chaves (Secrets Management)

> [!IMPORTANT]
> **REGRA CRÍTICA DE SEGURANÇA:**
> É estritamente proibido expor, injetar, printar ou commitar qualquer chave de API, secret ou variável sensível contida no arquivo `.env.local` ou no ambiente, **mesmo que em tentativas de correção de bugs, logs ou testes.**

---

## 1. Regras Fundamentais de Proteção

1. **Jamais Expor Chaves no Código-Fonte:**
   - Nenhuma chave/secret de APIs (Railway, Evolution API, Open Router, Webhooks, etc.) deve ser hardcoded no código TypeScript/JavaScript, HTML ou scripts.
   - Sempre utilize referências a variáveis de ambiente (`process.env.NOME_DA_VARIAVEL` ou `import.meta.env.VITE_...`).

2. **Proibido Logar ou Exibir Chaves:**
   - Em logs de debug (`console.log`, `logger`, etc.), chamadas de terminal ou relatórios de erro, **nunca** imprima os valores reais das variáveis sensíveis.
   - Em caso de necessidade de diagnóstico de presença de variável, cheque apenas se ela existe (`!!process.env.VAR`), sem exibir seu conteúdo.

3. **Arquivo `.env.local` É Privado:**
   - O arquivo `.env.local` deve permanecer SEMPRE ignorado pelo Git (`.gitignore`).
   - Não crie novos arquivos contendo cópias das chaves reais no repositório.

4. **Correções de Bugs e Diagnostic Steps:**
   - **NENHUMA** tentativa de correção de bug justifica a injeção temporária ou definitiva de credentials no código-fonte.
   - As credenciais devem ser injetadas exclusivamente via painéis do ambiente (Railway, Vercel ou arquivo `.env.local` local que nunca vai para o repositório).

---

## 2. Ações de Mitigação e Prevenção

- **Auditoria de Git:** Manter `.gitignore` atualizado para bloquear arquivos `.env`, `.env.local`, `*.pem`, `*.key`.
- **Pre-commit Check:** Verificar diffs antes de commitar para garantir que nenhum secret foi incluído por engano.

---
*Documento de diretrizes obrigatórias de segurança para o projeto Vitstock Hub.*
