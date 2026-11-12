const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Caminhos dos arquivos de persistência
const DATA_DIR = path.join(__dirname, 'data');
const PARTICIPANTS_FILE = path.join(DATA_DIR, 'participants.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'draw_history.json');
const ACTIVE_DRAW_FILE = path.join(DATA_DIR, 'draw_active.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data || JSON.stringify(defaultValue));
  } catch (err) {
    console.error(`Erro ao ler ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Erro ao escrever em ${filePath}:`, err.message);
    return false;
  }
}

// Configurações padrão
const defaultConfig = {
  eventName: 'Amigo Secreto da Família & Amigos',
  organizerPin: '1234',
  suggestedBudget: '50,00',
  eventDate: '',
  eventLocation: '',
  publicBaseUrl: '',
  emailSettings: {
    provider: 'gmail', // 'gmail', 'outlook', 'custom', 'simulation'
    user: '',
    pass: '',
    fromName: 'Amigo Secreto 🎅',
    customHost: '',
    customPort: 587,
    customSecure: false
  }
};

let participants = readJsonFile(PARTICIPANTS_FILE, []);
let config = readJsonFile(CONFIG_FILE, defaultConfig);
let drawHistory = readJsonFile(HISTORY_FILE, []);
let activeDraw = readJsonFile(ACTIVE_DRAW_FILE, null); // guarda o último sorteio ativo para consulta dos participantes

// Utilitário para embaralhar lista (Fisher-Yates)
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Oculta e-mail para exibição pública (ex: ca***s@gmail.com)
function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [user, domain] = email.split('@');
  if (user.length <= 2) {
    return `${user[0]}*@${domain}`;
  }
  return `${user.slice(0, 2)}***${user.slice(-1)}@${domain}`;
}

// Parser inteligente para importar vários nomes de uma vez
function parseBatchParticipants(text, defaultFamily = '') {
  const lines = text.split('\n');
  const results = [];
  let currentFamily = defaultFamily ? defaultFamily.trim() : '';

  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Detecta cabeçalhos de grupos/famílias como: "[Família Silva]", "Família Silva:", "Grupo Santos:"
    const headerBracket = line.match(/^\[(.*)\]$/);
    const headerColon = line.match(/^(?:Família|Familia|Grupo)?\s*(.*?):$/i);

    if (headerBracket) {
      currentFamily = headerBracket[1].trim();
      continue;
    } else if (headerColon && !line.includes(',') && !line.includes(' - ')) {
      currentFamily = headerColon[1].replace(/^(?:Família|Familia|Grupo)\s+/i, '').trim();
      if (!currentFamily.toLowerCase().startsWith('família') && !currentFamily.toLowerCase().startsWith('familia')) {
        currentFamily = `Família ${currentFamily}`;
      }
      continue;
    }

    let name = line;
    let family = currentFamily;

    // Detecta "Nome (Família)"
    const parenMatch = line.match(/^(.*?)\s*\((.*?)\)$/);
    if (parenMatch) {
      name = parenMatch[1].trim();
      family = parenMatch[2].trim();
    } else if (line.includes(' - ')) {
      const parts = line.split(' - ');
      name = parts[0].trim();
      family = parts.slice(1).join(' - ').trim();
    } else if (line.includes(',')) {
      const parts = line.split(',');
      name = parts[0].trim();
      family = parts.slice(1).join(',').trim();
    }

    if (name) {
      results.push({
        name,
        family: family || ''
      });
    }
  }

  return results;
}

// Algoritmo de Sorteio com Restrições de Família
function runSecretSantaDraw(list) {
  if (list.length < 3) {
    throw new Error('É necessário ter no mínimo 3 participantes para realizar o sorteio.');
  }

  const familyCounts = {};
  for (const p of list) {
    const fam = (p.family || '').trim().toLowerCase();
    if (fam) {
      familyCounts[fam] = (familyCounts[fam] || 0) + 1;
    }
  }

  for (const [famName, count] of Object.entries(familyCounts)) {
    if (count > list.length / 2) {
      const originalName = list.find(p => (p.family || '').trim().toLowerCase() === famName)?.family || famName;
      throw new Error(
        `Impossível realizar o sorteio: a família "${originalName}" tem ${count} pessoas, que é mais da metade do total de participantes (${list.length}). Alguém dessa família seria forçado a tirar outra pessoa da mesma família.`
      );
    }
  }

  const givers = [...list].sort((a, b) => {
    const fa = (a.family || '').trim().toLowerCase();
    const fb = (b.family || '').trim().toLowerCase();
    const countA = fa ? (familyCounts[fa] || 0) : 0;
    const countB = fb ? (familyCounts[fb] || 0) : 0;
    return countB - countA;
  });

  const total = givers.length;

  function solve(giverIndex, assignedReceiverIds, pairs) {
    if (giverIndex === total) return pairs;

    const giver = givers[giverIndex];
    const giverFam = (giver.family || '').trim().toLowerCase();

    let candidates = list.filter(receiver => {
      if (assignedReceiverIds.has(receiver.id)) return false;
      if (receiver.id === giver.id) return false;
      const receiverFam = (receiver.family || '').trim().toLowerCase();
      if (giverFam && receiverFam && giverFam === receiverFam) {
        return false;
      }
      return true;
    });

    candidates = shuffle(candidates);

    for (const candidate of candidates) {
      assignedReceiverIds.add(candidate.id);
      pairs.push({ giver, receiver: candidate });

      const result = solve(giverIndex + 1, assignedReceiverIds, pairs);
      if (result) return result;

      assignedReceiverIds.delete(candidate.id);
      pairs.pop();
    }

    return null;
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const result = solve(0, new Set(), []);
    if (result) return result;
  }

  throw new Error('Não foi possível encontrar uma combinação viável com as restrições fornecidas. Revise as famílias cadastradas.');
}

// Criação do Transporter de e-mail
function createTransporter(emailSettings) {
  if (emailSettings.provider === 'simulation') {
    return null;
  }

  if (emailSettings.provider === 'gmail') {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: emailSettings.user.trim(),
        pass: emailSettings.pass.replace(/\s+/g, '')
      }
    });
  }

  if (emailSettings.provider === 'outlook') {
    return nodemailer.createTransport({
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: {
        user: emailSettings.user.trim(),
        pass: emailSettings.pass.trim()
      },
      tls: {
        ciphers: 'SSLv3'
      }
    });
  }

  if (emailSettings.provider === 'custom') {
    return nodemailer.createTransport({
      host: emailSettings.customHost.trim(),
      port: Number(emailSettings.customPort) || 587,
      secure: Boolean(emailSettings.customSecure),
      auth: {
        user: emailSettings.user.trim(),
        pass: emailSettings.pass.trim()
      }
    });
  }

  throw new Error('Provedor de e-mail inválido ou não configurado.');
}

// Template HTML de e-mail moderno
function buildEmailHtml(giver, receiver, eventConfig) {
  const budgetHtml = eventConfig.suggestedBudget
    ? `<div style="background: #fdf2e9; border-left: 4px solid #e67e22; padding: 12px 16px; margin: 15px 0; border-radius: 4px;">
        <strong style="color: #d35400;">💰 Sugestão de Valor:</strong> R$ ${eventConfig.suggestedBudget}
       </div>`
    : '';

  const dateHtml = eventConfig.eventDate
    ? `<p style="margin: 6px 0; color: #555;">📅 <strong>Data da Revelação:</strong> ${eventConfig.eventDate}</p>`
    : '';

  const locationHtml = eventConfig.eventLocation
    ? `<p style="margin: 6px 0; color: #555;">📍 <strong>Local:</strong> ${eventConfig.eventLocation}</p>`
    : '';

  const wishlistHtml = (receiver.wishlist && receiver.wishlist.trim())
    ? `<div style="background: #eef2ff; border-left: 4px solid #4f46e5; padding: 12px 16px; margin: 15px 0; border-radius: 4px;">
        <strong style="color: #4338ca;">🎁 Dica de Presente / Observações de ${receiver.name}:</strong>
        <p style="margin: 6px 0 0 0; color: #374151; font-style: italic;">"${receiver.wishlist}"</p>
       </div>`
    : '';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Seu Amigo Secreto</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 30px 15px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
            <tr>
              <td style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 35px 25px; text-align: center; color: #ffffff;">
                <div style="font-size: 40px; margin-bottom: 10px;">🎁 🎅 🎄</div>
                <h1 style="margin: 0; font-size: 26px; font-weight: bold; letter-spacing: 0.5px;">${eventConfig.eventName || 'Amigo Secreto'}</h1>
                <p style="margin: 8px 0 0 0; font-size: 15px; opacity: 0.9;">O sorteio oficial acabou de acontecer!</p>
              </td>
            </tr>

            <tr>
              <td style="padding: 35px 30px; color: #1f2937;">
                <p style="font-size: 18px; margin-top: 0; color: #111827;">Olá, <strong>${giver.name}</strong>!</p>
                <p style="font-size: 15px; line-height: 1.6; color: #4b5563;">
                  A sorte foi lançada! Chegou o momento mais aguardado. Guarde este segredo a sete chaves:
                </p>

                <div style="background: linear-gradient(145deg, #f0fdf4 0%, #dcfce7 100%); border: 2px dashed #16a34a; border-radius: 10px; padding: 25px; text-align: center; margin: 25px 0;">
                  <span style="font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; color: #15803d; font-weight: bold; display: block; margin-bottom: 8px;">
                    Seu Amigo Secreto é
                  </span>
                  <div style="font-size: 32px; font-weight: 800; color: #166534; letter-spacing: 0.5px;">
                    🎉 ${receiver.name} 🎉
                  </div>
                </div>

                ${wishlistHtml}
                ${budgetHtml}

                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 14px;">
                  ${dateHtml}
                  ${locationHtml}
                </div>

                <div style="margin-top: 25px; background-color: #fef2f2; border-radius: 8px; padding: 15px; text-align: center;">
                  <p style="margin: 0; font-size: 14px; color: #991b1b; font-weight: 600;">
                    🤫 Psiu! Não conte para ninguém quem você tirou até o momento da revelação!
                  </p>
                </div>
              </td>
            </tr>

            <tr>
              <td style="background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
                Este e-mail foi gerado automaticamente pelo sistema de Amigo Secreto.<br>
                Boas festas e boas comemorações! ✨
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

// ======================== ROTAS DA API ========================

// 1. Configurações Públicas
app.get('/api/config', (req, res) => {
  activeDraw = readJsonFile(ACTIVE_DRAW_FILE, activeDraw);
  res.json({
    eventName: config.eventName,
    suggestedBudget: config.suggestedBudget,
    eventDate: config.eventDate,
    eventLocation: config.eventLocation,
    publicBaseUrl: config.publicBaseUrl || '',
    provider: config.emailSettings?.provider || 'web',
    fromName: config.emailSettings?.fromName || 'Amigo Secreto 🎅',
    drawCompleted: Boolean(activeDraw),
    activeDrawDate: activeDraw ? activeDraw.date : null,
    hasEmailConfigured: Boolean(config.emailSettings && config.emailSettings.user && config.emailSettings.pass)
  });
});

// 2. Verificar PIN do Organizador
app.post('/api/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (pin && pin.trim() === config.organizerPin) {
    return res.json({ success: true, authorized: true });
  }
  return res.status(401).json({ success: false, error: 'PIN de organizador incorreto.' });
});

// 3. Atualizar configurações do evento e e-mail (requer PIN do organizador)
app.post('/api/config', (req, res) => {
  const { pin, eventName, organizerPin, suggestedBudget, eventDate, eventLocation, publicBaseUrl, emailSettings } = req.body;

  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  if (eventName) config.eventName = eventName.trim();
  if (suggestedBudget !== undefined) config.suggestedBudget = suggestedBudget;
  if (eventDate !== undefined) config.eventDate = eventDate;
  if (eventLocation !== undefined) config.eventLocation = eventLocation;
  if (publicBaseUrl !== undefined) config.publicBaseUrl = publicBaseUrl.trim();
  if (organizerPin && organizerPin.trim()) config.organizerPin = organizerPin.trim();

  if (emailSettings) {
    config.emailSettings = {
      ...config.emailSettings,
      provider: emailSettings.provider || config.emailSettings.provider,
      user: emailSettings.user !== undefined ? emailSettings.user.trim() : config.emailSettings.user,
      pass: emailSettings.pass !== undefined ? emailSettings.pass.trim() : config.emailSettings.pass,
      fromName: emailSettings.fromName || config.emailSettings.fromName,
      customHost: emailSettings.customHost || '',
      customPort: emailSettings.customPort || 587,
      customSecure: Boolean(emailSettings.customSecure)
    };
  }

  writeJsonFile(CONFIG_FILE, config);
  res.json({ success: true, message: 'Configurações salvas com sucesso!' });
});

// 4. Listar participantes
// Se for o organizador autenticado, retorna dados completos.
// Se for visitante/participante comum, mascara o e-mail e não expõe a senha/PIN!
app.get('/api/participants', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  participants = readJsonFile(PARTICIPANTS_FILE, participants);

  const isOrganizer = req.query.organizerPin === config.organizerPin;

  const sanitized = participants.map(p => {
    const hasPin = Boolean((p.pin && String(p.pin).trim().length === 4));
    const isClaimed = Boolean(p.claimed || hasPin || (p.email && p.email.trim().includes('@')));
    if (isOrganizer) {
      return {
        ...p,
        claimed: isClaimed,
        hasPin
      };
    }
    return {
      id: p.id,
      name: p.name,
      family: p.family,
      wishlist: p.wishlist || '',
      claimed: isClaimed,
      hasPin,
      emailMasked: (p.email && p.email.includes('@')) ? maskEmail(p.email) : '',
      createdAt: p.createdAt
    };
  });

  const claimedCount = participants.filter(p => Boolean(p.claimed || (p.pin && String(p.pin).trim().length === 4) || (p.email && p.email.trim().includes('@')))).length;

  res.json({
    participants: sanitized,
    total: participants.length,
    claimedCount,
    unclaimedCount: participants.length - claimedCount,
    drawCompleted: Boolean(activeDraw)
  });
});

// 5. Adicionar participante individual (Organizador)
app.post('/api/participants', (req, res) => {
  const { name, email, family, wishlist } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'O nome é obrigatório.' });
  }

  // Verifica nome duplicado
  const nameExists = participants.some(p => p.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (nameExists) {
    return res.status(400).json({ error: `Já existe um participante cadastrado com o nome "${name.trim()}".` });
  }

  const cleanEmail = (email || '').trim().toLowerCase();

  const newParticipant = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
    name: name.trim(),
    email: cleanEmail,
    pin: '',
    family: (family || '').trim(),
    wishlist: (wishlist || '').trim(),
    createdAt: new Date().toISOString()
  };

  participants.push(newParticipant);
  writeJsonFile(PARTICIPANTS_FILE, participants);

  res.status(201).json({ success: true, participant: newParticipant });
});

// 6. Inserir VÁRIOS nomes de uma vez (Lote / Bulk) - Organizador
app.post('/api/participants/bulk', (req, res) => {
  const { pin, rawText, defaultFamily } = req.body;

  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  if (!rawText || !rawText.trim()) {
    return res.status(400).json({ error: 'Nenhum texto informado para importação.' });
  }

  const parsed = parseBatchParticipants(rawText, defaultFamily || '');
  if (parsed.length === 0) {
    return res.status(400).json({ error: 'Nenhum nome válido encontrado no texto.' });
  }

  let addedCount = 0;
  const skipped = [];

  for (const item of parsed) {
    const exists = participants.some(p => p.name.trim().toLowerCase() === item.name.toLowerCase());
    if (exists) {
      skipped.push(item.name);
      continue;
    }

    participants.push({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6) + addedCount,
      name: item.name,
      email: '',
      pin: '',
      family: item.family || '',
      wishlist: '',
      createdAt: new Date().toISOString()
    });
    addedCount++;
  }

  writeJsonFile(PARTICIPANTS_FILE, participants);

  res.json({
    success: true,
    addedCount,
    skippedCount: skipped.length,
    skippedNames: skipped,
    total: participants.length
  });
});

// 7. PARTICIPANTE: Cadastrar seu e-mail e criar senha de 4 dígitos
app.post('/api/participants/claim', (req, res) => {
  const { id, email, pin, wishlist, currentPin } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'ID do participante não informado.' });
  }

  const participant = participants.find(p => p.id === id);
  if (!participant) {
    return res.status(404).json({ error: 'Participante não encontrado na lista.' });
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  if (cleanEmail && (!cleanEmail.includes('@') || !cleanEmail.includes('.'))) {
    return res.status(400).json({ error: 'Por favor, informe um endereço de e-mail válido ou deixe em branco.' });
  }

  const cleanPin = (pin || '').trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return res.status(400).json({ error: 'A senha deve conter exatamente 4 dígitos numéricos (ex: 1234).' });
  }

  // Se já tinha senha cadastrada, exige confirmação da senha anterior para alterar
  if (participant.pin) {
    if (currentPin && currentPin !== participant.pin) {
      return res.status(403).json({
        error: 'Senha anterior incorreta. Para alterar seus dados, informe sua senha de 4 dígitos anterior.'
      });
    }
  }

  participant.email = cleanEmail || participant.email || '';
  participant.pin = cleanPin;
  participant.claimed = true;
  if (wishlist !== undefined) {
    participant.wishlist = wishlist.trim();
  }

  writeJsonFile(PARTICIPANTS_FILE, participants);

  // Se já houver um sorteio ativo realizado, dispara o e-mail automaticamente agora que ela cadastrou!
  let emailDispatched = false;
  if (activeDraw && activeDraw.pairs && config.emailSettings && config.emailSettings.user && config.emailSettings.provider !== 'simulation') {
    const myPair = activeDraw.pairs.find(p => p.giverId === participant.id);
    if (myPair) {
      try {
        const transporter = createTransporter(config.emailSettings);
        const receiverObj = {
          name: myPair.receiverName,
          wishlist: myPair.receiverWishlist
        };
        const htmlContent = buildEmailHtml(participant, receiverObj, config);
        
        // Envio assíncrono em segundo plano
        transporter.sendMail({
          from: `"${config.emailSettings.fromName || 'Amigo Secreto'}" <${config.emailSettings.user}>`,
          to: participant.email,
          subject: `🎅 [${participant.name}] Seu Amigo Secreto: ${config.eventName}`,
          html: htmlContent
        }).catch(err => console.error(`Erro ao disparar e-mail pós-sorteio para ${participant.email}:`, err.message));

        emailDispatched = true;
      } catch (err) {
        console.error('Erro ao preparar envio pós-sorteio:', err.message);
      }
    }
  }

  const successMessage = emailDispatched
    ? `E-mail cadastrado com sucesso! Como o sorteio já foi realizado, o seu amigo secreto acabou de ser enviado para ${participant.email}!`
    : `E-mail e senha de 4 dígitos cadastrados com sucesso para ${participant.name}!`;

  res.json({
    success: true,
    message: successMessage,
    participant: {
      id: participant.id,
      name: participant.name,
      emailMasked: maskEmail(participant.email),
      wishlist: participant.wishlist,
      claimed: true
    }
  });
});

// 8. PARTICIPANTE: Entrar com a senha de 4 dígitos para ver seu amigo secreto sorteado
app.post('/api/participant/my-draw', (req, res) => {
  const { id, pin } = req.body;

  if (!id) return res.status(400).json({ error: 'Participante não identificado.' });

  const participant = participants.find(p => p.id === id);
  if (!participant) return res.status(404).json({ error: 'Participante não encontrado.' });

  if (!participant.pin) {
    return res.status(400).json({ error: 'Você ainda não cadastrou seu e-mail e senha de 4 dígitos.' });
  }

  if (participant.pin !== (pin || '').trim()) {
    return res.status(401).json({ error: 'Senha de 4 dígitos incorreta. Tente novamente.' });
  }

  // Se o sorteio ainda NÃO aconteceu
  if (!activeDraw) {
    return res.json({
      drawCompleted: false,
      message: 'O sorteio ainda não foi realizado pelo organizador.',
      participant: {
        id: participant.id,
        name: participant.name,
        email: participant.email,
        wishlist: participant.wishlist
      }
    });
  }

  // Procura o par onde este participante é o giver
  const myPair = activeDraw.pairs.find(p => p.giverId === participant.id);
  if (!myPair) {
    return res.status(404).json({ error: 'Seu sorteio não foi localizado. Fale com o organizador.' });
  }

  res.json({
    drawCompleted: true,
    giverName: participant.name,
    receiverName: myPair.receiverName,
    receiverWishlist: myPair.receiverWishlist || '',
    eventConfig: {
      eventName: config.eventName,
      suggestedBudget: config.suggestedBudget,
      eventDate: config.eventDate,
      eventLocation: config.eventLocation
    }
  });
});

// 9. Atualizar participante (Organizador)
app.put('/api/participants/:id', (req, res) => {
  const { pin, name, email, family, wishlist, participantPin } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  const index = participants.findIndex(p => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Participante não encontrado.' });
  }

  if (name) participants[index].name = name.trim();
  if (email !== undefined) participants[index].email = email.trim().toLowerCase();
  if (family !== undefined) participants[index].family = family.trim();
  if (wishlist !== undefined) participants[index].wishlist = wishlist.trim();
  if (participantPin !== undefined) participants[index].pin = participantPin.trim();

  writeJsonFile(PARTICIPANTS_FILE, participants);
  res.json({ success: true, participant: participants[index] });
});

// 10. Remover participante (Organizador)
app.delete('/api/participants/:id', (req, res) => {
  const { pin } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  participants = participants.filter(p => p.id !== req.params.id);
  writeJsonFile(PARTICIPANTS_FILE, participants);
  res.json({ success: true, message: 'Participante removido com sucesso.' });
});

// 11. Limpar todos os participantes (Organizador)
app.post('/api/participants/clear', (req, res) => {
  const { pin } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  participants = [];
  activeDraw = null;
  writeJsonFile(PARTICIPANTS_FILE, participants);
  writeJsonFile(ACTIVE_DRAW_FILE, null);
  res.json({ success: true, message: 'Lista de participantes esvaziada.' });
});

// 12. Carregar dados de exemplo (Organizador)
app.post('/api/participants/sample', (req, res) => {
  const { pin } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  participants = [
    { id: '1', name: 'Carlos Silva', email: 'carlos.silva@exemplo.com', pin: '1234', family: 'Família Silva', wishlist: 'Livro de ficção ou café especial', createdAt: new Date().toISOString() },
    { id: '2', name: 'Mariana Silva', email: '', pin: '', family: 'Família Silva', wishlist: '', createdAt: new Date().toISOString() },
    { id: '3', name: 'Pedro Silva', email: '', pin: '', family: 'Família Silva', wishlist: '', createdAt: new Date().toISOString() },
    { id: '4', name: 'Ana Souza', email: 'ana.souza@exemplo.com', pin: '1234', family: 'Família Souza', wishlist: 'Caneca térmica ou chocolate', createdAt: new Date().toISOString() },
    { id: '5', name: 'Lucas Souza', email: '', pin: '', family: 'Família Souza', wishlist: '', createdAt: new Date().toISOString() },
    { id: '6', name: 'Beatriz Lima', email: 'beatriz.lima@exemplo.com', pin: '1234', family: 'Família Lima', wishlist: 'Agenda ou canetas', createdAt: new Date().toISOString() },
    { id: '7', name: 'Rafael Lima', email: '', pin: '', family: 'Família Lima', wishlist: '', createdAt: new Date().toISOString() },
    { id: '8', name: 'João Solteiro', email: '', pin: '', family: '', wishlist: '', createdAt: new Date().toISOString() }
  ];

  writeJsonFile(PARTICIPANTS_FILE, participants);
  res.json({ success: true, count: participants.length, participants });
});

// 13. Testar envio de e-mail (Organizador)
app.post('/api/test-email', async (req, res) => {
  const { pin, testRecipient } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  const recipient = (testRecipient || config.emailSettings.user || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return res.status(400).json({ error: 'Por favor, informe um e-mail para receber o teste.' });
  }

  if (config.emailSettings.provider === 'simulation') {
    return res.json({
      success: true,
      message: 'Modo Simulação ativado: O teste foi validado localmente.'
    });
  }

  try {
    const transporter = createTransporter(config.emailSettings);
    await transporter.verify();

    const info = await transporter.sendMail({
      from: `"${config.emailSettings.fromName || 'Amigo Secreto'}" <${config.emailSettings.user}>`,
      to: recipient,
      subject: `🧪 Teste de Conexão: ${config.eventName}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #16a34a;">✅ Servidor de e-mail conectado com sucesso!</h2>
          <p>Este é um e-mail de teste do seu evento <strong>${config.eventName}</strong>.</p>
          <p>Quando o sorteio for realizado, os participantes que cadastraram e-mail receberão a revelação por aqui.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <small style="color: #666;">Enviado em: ${new Date().toLocaleString('pt-BR')}</small>
        </div>
      `
    });

    res.json({
      success: true,
      message: `E-mail de teste enviado com sucesso para ${recipient}!`,
      messageId: info.messageId
    });
  } catch (err) {
    console.error('Erro no envio de teste:', err);
    res.status(500).json({
      success: false,
      error: `Falha ao conectar ou enviar: ${err.message}. Verifique a Senha de App do Google.`
    });
  }
});

// 14. Realizar Sorteio e Enviar E-mails
app.post('/api/draw', async (req, res) => {
  const { pin, dryRun } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  if (participants.length < 3) {
    return res.status(400).json({ error: 'Cadastre pelo menos 3 participantes para poder sortear.' });
  }

  let pairs;
  try {
    pairs = runSecretSantaDraw(participants);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const provider = config.emailSettings?.provider || 'web';
  const shouldSendEmail = (provider !== 'web' && provider !== 'simulation') && (req.body.sendEmails === true) && !dryRun;
  const isSimulation = !shouldSendEmail;
  const results = [];
  let transporter = null;

  if (shouldSendEmail) {
    if (!config.emailSettings || !config.emailSettings.user || !config.emailSettings.pass) {
      return res.status(400).json({
        error: 'Para disparar e-mails pela internet, preencha as configurações de e-mail na Aba 1 ou use o Modo Web.'
      });
    }
    try {
      transporter = createTransporter(config.emailSettings);
      await transporter.verify();
    } catch (err) {
      return res.status(500).json({
        error: `Não foi possível conectar ao servidor de e-mail: ${err.message}.`
      });
    }
  }

  for (const pair of pairs) {
    const giver = pair.giver;
    const receiver = pair.receiver;
    const hasPin = Boolean(giver.pin && String(giver.pin).trim().length === 4);

    if (!shouldSendEmail) {
      results.push({
        name: giver.name,
        email: giver.email || '(Consulta via site)',
        status: hasPin ? 'pronto_site' : 'pendente_senha',
        message: hasPin ? 'Senha de 4 dígitos ativa! Pronto para ver no site.' : 'Aguardando participante criar senha de 4 dígitos no site.'
      });
      continue;
    }

    // Se deve enviar e-mail mas o participante não cadastrou e-mail
    if (!giver.email || !giver.email.includes('@')) {
      results.push({
        name: giver.name,
        email: '(Sem e-mail cadastrado)',
        status: hasPin ? 'pronto_site' : 'pendente_senha',
        message: 'A pessoa não cadastrou e-mail, mas poderá ver no site com a senha de 4 dígitos!'
      });
      continue;
    }

    try {
      const htmlContent = buildEmailHtml(giver, receiver, config);
      await transporter.sendMail({
        from: `"${config.emailSettings.fromName || 'Amigo Secreto'}" <${config.emailSettings.user}>`,
        to: giver.email,
        subject: `🎅 [${giver.name}] Seu Amigo Secreto: ${config.eventName}`,
        html: htmlContent
      });

      results.push({
        name: giver.name,
        email: giver.email,
        status: 'enviado',
        message: 'E-mail entregue com sucesso'
      });

      await new Promise(resolve => setTimeout(resolve, 400));
    } catch (sendErr) {
      console.error(`Erro ao enviar para ${giver.email}:`, sendErr.message);
      results.push({
        name: giver.name,
        email: giver.email,
        status: 'erro',
        error: sendErr.message
      });
    }
  }

  // Prepara estrutura ativa para consulta dos participantes
  activeDraw = {
    drawId: Date.now().toString(),
    date: new Date().toISOString(),
    isSimulation,
    pairs: pairs.map(p => ({
      giverId: p.giver.id,
      giverName: p.giver.name,
      giverEmail: p.giver.email || '',
      receiverId: p.receiver.id,
      receiverName: p.receiver.name,
      receiverWishlist: p.receiver.wishlist || ''
    }))
  };

  writeJsonFile(ACTIVE_DRAW_FILE, activeDraw);

  // Histórico
  drawHistory.unshift({
    id: activeDraw.drawId,
    date: activeDraw.date,
    totalParticipants: participants.length,
    isSimulation,
    resultsSummary: results,
    pairs: activeDraw.pairs
  });
  writeJsonFile(HISTORY_FILE, drawHistory);

  const successCount = results.filter(r => r.status === 'enviado' || r.status === 'simulado').length;
  const pendingCount = results.filter(r => r.status === 'pendente_email').length;
  const errorCount = results.filter(r => r.status === 'erro').length;

  res.json({
    success: true,
    message: shouldSendEmail
      ? `Sorteio concluído! ${successCount} e-mails enviados.${pendingCount > 0 ? ` (${pendingCount} participantes sem e-mail verão pelo site com a senha)` : ''}`
      : `Sorteio realizado com sucesso! Todos os ${participants.length} participantes já podem consultar seu amigo secreto no site digitando a senha de 4 dígitos!`,
    isSimulation,
    summary: {
      total: participants.length,
      successCount,
      pendingCount,
      errorCount
    },
    results
  });
});

// 15. Histórico e Gabarito de Emergência (Organizador)
app.post('/api/draw/history', (req, res) => {
  const { pin } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  res.json({
    history: drawHistory,
    activeDraw
  });
});

// 16. Resetar Sorteio Ativo (Permite refazer se o organizador quiser)
app.post('/api/draw/reset', (req, res) => {
  const { pin } = req.body;
  if (pin !== config.organizerPin) {
    return res.status(401).json({ error: 'PIN de organizador inválido.' });
  }

  activeDraw = null;
  writeJsonFile(ACTIVE_DRAW_FILE, null);
  res.json({ success: true, message: 'Sorteio resetado. Um novo sorteio pode ser realizado.' });
});

// Inicia servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🎉 Servidor do Amigo Secreto iniciado com sucesso!`);
  console.log(`🏠 Acesse no seu computador: http://localhost:${PORT}`);
  console.log(`=================================================`);
});
