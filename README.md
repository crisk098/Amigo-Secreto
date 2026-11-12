# 🎁 Amigo Secreto com Regras de Família, Cadastro por Link & Envio por E-mail

Sistema completo de Amigo Secreto desenvolvido em **Node.js + Express** com interface moderna e responsiva.

---

## 🌟 Novo Fluxo: Importação em Lote & Auto-Cadastro de E-mail

Você **não precisa saber os e-mails das pessoas com antecedência**!

1. **📋 Adicionar Vários Nomes de Uma Vez:**
   - No painel, clique em **"➕ Adicionar Vários Nomes de Uma Vez"**.
   - Cole a lista de participantes (um por linha) ou agrupada por família:
     ```text
     Família Silva:
     Carlos
     Mariana
     Pedro

     Família Santos:
     Ana
     Lucas

     Sem Família:
     João
     Beatriz
     ```

2. **🔗 Compartilhar o Link:**
   - Clique em **"📋 Copiar Link"** no topo da tela e envie no grupo do WhatsApp da família ou amigos.
   - Qualquer pessoa abre o link no celular ou computador.

3. **👤 Cada pessoa clica no seu nome:**
   - Na lista de cards, cada participante localiza o seu nome e clica em **"👉 Cadastrar Meu E-mail"**.
   - A pessoa digita o **e-mail** onde quer receber o resultado e cria uma **senha simples de 4 dígitos** (ex: `1234`).
   - Também pode adicionar uma sugestão de presente!

4. **🎲 Sorteio & Envio:**
   - O organizador acompanha quem já cadastrou o e-mail em tempo real.
   - Ao clicar em **"Realizar Sorteio"**, o algoritmo sorteia garantindo que **pessoas da mesma família não tirem uma à outra** e dispara os e-mails individualmente!
   - Além disso, qualquer participante pode voltar ao site e clicar em **"🔑 Ver meu Amigo / Minha Senha"** digitando os 4 dígitos para ver quem tirou diretamente na tela!

---

## 🚀 Como Iniciar no seu Computador

1. Abra o terminal nesta pasta e execute:
   ```bash
   npm start
   ```

2. Acesse no navegador:
   👉 **http://localhost:3000**

---

## 🌐 Como Deixar Online Grátis para os Amigos Acessarem

Com o servidor rodando (`npm start`), abra **outro terminal** e digite:

```bash
npx localtunnel --port 3000
```
- Você receberá um link público instantâneo (exemplo: `https://meu-amigo-123.loca.lt`).
- Cole esse link no campo **"Link Público do Túnel"** (Aba 2 de Configurações) para que o botão de copiar gere o link exato para o WhatsApp!
