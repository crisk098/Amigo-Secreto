// Estado Global
let participants = [];
let config = {};
let organizerPin = localStorage.getItem('organizerPin') || '1234';
let isOrganizerLoggedIn = localStorage.getItem('isOrganizerLoggedIn') === 'true';
let currentFilter = 'all';
let searchQuery = '';
let activeParticipantForClaim = null;
let activeParticipantForLogin = null;
let isRevealed = false;

// Paleta de cores para as tags de famílias
const FAMILY_COLORS = [
  { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' }, // Azul
  { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }, // Verde
  { bg: '#fef3c7', text: '#92400e', border: '#fde68a' }, // Âmbar
  { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' }, // Roxo
  { bg: '#ffe4e6', text: '#9f1239', border: '#fecdd3' }, // Rosa
  { bg: '#ffedd5', text: '#9a3412', border: '#fed7aa' }, // Laranja
  { bg: '#ccfbf1', text: '#115e59', border: '#99f6e4' }, // Teal
  { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' }  // Índigo
];

const familyColorMap = {};

function getFamilyStyle(familyName) {
  if (!familyName || !familyName.trim()) return null;
  const normalized = familyName.trim().toLowerCase();
  if (!familyColorMap[normalized]) {
    const keys = Object.keys(familyColorMap);
    const colorObj = FAMILY_COLORS[keys.length % FAMILY_COLORS.length];
    familyColorMap[normalized] = colorObj;
  }
  return familyColorMap[normalized];
}

function hasRegisteredEmail(p) {
  if (!p) return false;
  if (p.claimed === true) return true;
  if (p.email && p.email.trim().includes('@')) return true;
  if (p.emailMasked && p.emailMasked.trim().includes('@')) return true;
  return false;
}

// Inicialização da Página
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  updateOrganizerView();
  loadParticipants();
});

// Atualiza a visualização com base no status do Organizador
function updateOrganizerView() {
  const organizerSection = document.getElementById('organizerSection');
  const lockedNotice = document.getElementById('organizerLockedNotice');
  const authBtn = document.getElementById('authBtn');

  if (isOrganizerLoggedIn) {
    if (organizerSection) organizerSection.style.display = 'block';
    if (lockedNotice) lockedNotice.style.display = 'none';
    if (authBtn) {
      authBtn.textContent = '🔓 Sair do Modo Organizador';
      authBtn.onclick = logoutOrganizer;
    }
  } else {
    if (organizerSection) organizerSection.style.display = 'none';
    if (lockedNotice) lockedNotice.style.display = 'block';
    if (authBtn) {
      authBtn.textContent = '🔒 Área do Organizador';
      authBtn.onclick = toggleOrganizerModal;
    }
  }
}

function logoutOrganizer() {
  if (confirm('Deseja sair do Modo Organizador?')) {
    isOrganizerLoggedIn = false;
    localStorage.removeItem('isOrganizerLoggedIn');
    updateOrganizerView();
    loadParticipants(); // Recarrega com visão pública
  }
}

// Navegação das Abas do Organizador
async function switchOrganizerTab(tabId) {
  document.querySelectorAll('#organizerSection .tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('#organizerSection .tab-content').forEach(content => content.classList.remove('active'));

  if (tabId === 'tab-settings') document.getElementById('tabBtnSettings')?.classList.add('active');
  if (tabId === 'tab-draw') document.getElementById('tabBtnDraw')?.classList.add('active');
  if (tabId === 'tab-history') document.getElementById('tabBtnHistory')?.classList.add('active');

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');

  if (tabId === 'tab-draw') {
    await loadParticipants();
    updateDrawChecklist();
  }
  if (tabId === 'tab-history') loadDrawHistory();
}

// 1. Carregar Configurações
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();

    if (config.eventName) {
      document.getElementById('headerEventTitle').textContent = `🎁 ${config.eventName}`;
      document.getElementById('cfgEventName').value = config.eventName;
    }
    if (config.suggestedBudget) document.getElementById('cfgBudget').value = config.suggestedBudget;
    if (config.eventDate) document.getElementById('cfgDate').value = config.eventDate;
    if (config.eventLocation) document.getElementById('cfgLocation').value = config.eventLocation;
    if (config.publicBaseUrl) document.getElementById('cfgPublicBaseUrl').value = config.publicBaseUrl;
    if (config.provider) {
      document.getElementById('cfgProvider').value = config.provider;
      handleProviderChange();
    }
    if (config.fromName) document.getElementById('cfgFromName').value = config.fromName;
    document.getElementById('cfgPin').value = organizerPin;

    const currentOrigin = config.publicBaseUrl || window.location.origin;
    document.getElementById('shareUrlInput').value = currentOrigin;

  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

// 2. Carregar Participantes
async function loadParticipants() {
  try {
    const pinParam = isOrganizerLoggedIn ? `?organizerPin=${encodeURIComponent(organizerPin)}` : '';
    const res = await fetch(`/api/participants${pinParam}`);
    const data = await res.json();
    participants = data.participants || [];
    renderParticipantsGrid();
    validateFamilyConstraints();
    if (isOrganizerLoggedIn) {
      updateDrawChecklist();
    }
  } catch (err) {
    console.error('Erro ao carregar participantes:', err);
  }
}

// 3. Renderizar Grid de Participantes (No topo da página)
function renderParticipantsGrid() {
  const grid = document.getElementById('participantsGrid');
  const datalist = document.getElementById('familySuggestions');

  grid.innerHTML = '';
  datalist.innerHTML = '';

  const uniqueFamilies = new Set();
  let claimedCount = 0;

  participants.forEach(p => {
    if (p.family && p.family.trim()) uniqueFamilies.add(p.family.trim());
    if (hasRegisteredEmail(p)) claimedCount++;
  });

  // Atualiza contadores
  document.getElementById('statTotalCount').textContent = participants.length;
  document.getElementById('statClaimedCount').textContent = claimedCount;
  document.getElementById('statUnclaimedCount').textContent = participants.length - claimedCount;
  document.getElementById('statFamilyCount').textContent = uniqueFamilies.size;

  uniqueFamilies.forEach(fam => {
    const opt = document.createElement('option');
    opt.value = fam;
    datalist.appendChild(opt);
  });

  let filtered = participants.filter(p => {
    if (currentFilter === 'pending' && p.claimed) return false;
    if (currentFilter === 'claimed' && !p.claimed) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchFamily = (p.family || '').toLowerCase().includes(q);
      return matchName || matchFamily;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: white; border-radius: 12px; border: 1.5px dashed var(--gray-300);">
        <div style="font-size: 3rem; margin-bottom: 8px;">👥</div>
        <h3 style="color: var(--dark); margin-bottom: 6px;">Nenhum participante encontrado</h3>
        <p style="color: var(--gray-500); margin-bottom: 16px;">
          ${participants.length === 0 
            ? 'A lista ainda está vazia. O organizador pode adicionar os nomes no painel abaixo!' 
            : 'Tente alterar os termos da busca ou os filtros acima.'}
        </p>
        ${participants.length === 0 && isOrganizerLoggedIn
          ? `<button class="btn btn-primary" onclick="openBulkModal()">➕ Adicionar Nomes Agora</button>`
          : ''}
      </div>
    `;
    return;
  }

  filtered.forEach(p => {
    const famStyle = getFamilyStyle(p.family);
    const familyBadgeHtml = famStyle
      ? `<span class="family-badge" style="background-color: ${famStyle.bg}; color: ${famStyle.text}; border-color: ${famStyle.border}">
           🏡 ${escapeHtml(p.family)}
         </span>`
      : `<span class="family-badge family-none">Sem Restrição</span>`;

    const initials = p.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

    const isClaimed = hasRegisteredEmail(p);
    const card = document.createElement('div');
    card.className = `person-card ${isClaimed ? 'claimed' : ''}`;

    let statusHtml = '';
    let actionBtnHtml = '';

    if (!isClaimed) {
      statusHtml = `
        <div class="person-status">
          <span class="status-badge-pending">🟡 Aguardando E-mail & Senha</span>
        </div>
      `;
      actionBtnHtml = `
        <button class="btn btn-secondary btn-block" onclick="openClaimModal('${p.id}')">
          👉 Cadastrar Meu E-mail
        </button>
      `;
    } else {
      const emailDisplay = p.emailMasked || p.email || 'Cadastrado';
      statusHtml = `
        <div class="person-status">
          <span class="status-badge-claimed">🟢 Confirmado (${escapeHtml(emailDisplay)})</span>
        </div>
      `;
      actionBtnHtml = `
        <button class="btn btn-outline btn-block" onclick="openMyDrawModal('${p.id}')">
          🔑 Ver meu Amigo / Minha Senha
        </button>
      `;
    }

    // Botão de excluir visível SOMENTE se for organizador logado
    const deleteBtnHtml = isOrganizerLoggedIn
      ? `<button title="Excluir Participante" style="background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 1.1rem; padding: 4px;" onclick="removeParticipant('${p.id}')">✕</button>`
      : '';

    card.innerHTML = `
      <div>
        <div class="person-header">
          <div class="person-avatar">${initials}</div>
          <div style="flex: 1; min-width: 0;">
            <div class="person-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${escapeHtml(p.name)}
            </div>
            ${familyBadgeHtml}
          </div>
          ${deleteBtnHtml}
        </div>
        ${statusHtml}
        ${p.wishlist ? `<div style="font-size: 0.83rem; color: #64748b; font-style: italic; margin-bottom: 12px; background: #f8fafc; padding: 6px 10px; border-radius: 6px;">🎁 Dica: ${escapeHtml(p.wishlist)}</div>` : ''}
      </div>
      <div style="margin-top: 10px;">
        ${actionBtnHtml}
      </div>
    `;

    grid.appendChild(card);
  });
}

// 4. Busca e Filtros
function handleSearch() {
  searchQuery = document.getElementById('searchInput').value.trim();
  renderParticipantsGrid();
}

function setFilter(type) {
  currentFilter = type;
  document.getElementById('filterAll').className = `btn btn-sm ${type === 'all' ? 'btn-primary' : 'btn-outline'}`;
  document.getElementById('filterPending').className = `btn btn-sm ${type === 'pending' ? 'btn-primary' : 'btn-outline'}`;
  document.getElementById('filterClaimed').className = `btn btn-sm ${type === 'claimed' ? 'btn-primary' : 'btn-outline'}`;
  renderParticipantsGrid();
}

// 5. Validar Restrições de Família (Regra da Maioria)
function validateFamilyConstraints() {
  const familyCounts = {};
  for (const p of participants) {
    const fam = (p.family || '').trim();
    if (fam) familyCounts[fam] = (familyCounts[fam] || 0) + 1;
  }

  const alertBox = document.getElementById('familyWarningAlert');
  const alertText = document.getElementById('familyWarningText');

  let invalidFamily = null;
  const half = participants.length / 2;

  for (const [famName, count] of Object.entries(familyCounts)) {
    if (count > half) {
      invalidFamily = { name: famName, count };
      break;
    }
  }

  if (invalidFamily && participants.length > 2) {
    alertBox.style.display = 'flex';
    alertText.innerHTML = `
      <strong>Atenção às Restrições:</strong> A <strong>"${escapeHtml(invalidFamily.name)}"</strong> possui ${invalidFamily.count} pessoas, 
      que é mais da metade do total de participantes (${participants.length}).<br>
      Para que o sorteio funcione sem que pessoas da mesma família se tirem, adicione participantes de outras famílias ou sem família.
    `;
    return false;
  } else {
    alertBox.style.display = 'none';
    return true;
  }
}

// 6. MODAL: Participante Cadastrar E-mail e Senha de 4 Dígitos (AJUSTADO E CORRIGIDO)
function openClaimModal(participantId) {
  const p = participants.find(item => item.id === participantId);
  if (!p) return;

  activeParticipantForClaim = p;

  document.getElementById('claimParticipantId').value = p.id;
  document.getElementById('claimModalName').textContent = p.name;
  document.getElementById('claimModalAvatar').textContent = p.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  
  const famStyle = getFamilyStyle(p.family);
  const badgeContainer = document.getElementById('claimModalFamilyBadge');
  badgeContainer.innerHTML = famStyle
    ? `<span class="family-badge" style="background-color: ${famStyle.bg}; color: ${famStyle.text}; border-color: ${famStyle.border}">🏡 ${escapeHtml(p.family)}</span>`
    : `<span class="family-badge family-none">Sem Restrição</span>`;

  document.getElementById('claimEmail').value = p.email || '';
  document.getElementById('claimPin').value = '';
  document.getElementById('claimWishlist').value = p.wishlist || '';

  document.getElementById('claimModal').classList.add('active');
  document.getElementById('claimEmail').focus();
}

function closeClaimModal() {
  document.getElementById('claimModal').classList.remove('active');
  activeParticipantForClaim = null;
}

async function handleClaimSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!activeParticipantForClaim) return;

  // Guarda os dados locais antes de qualquer ação
  const pId = activeParticipantForClaim.id;
  const pName = activeParticipantForClaim.name;

  const email = document.getElementById('claimEmail').value.trim();
  const pin = document.getElementById('claimPin').value.trim();
  const wishlist = document.getElementById('claimWishlist').value.trim();

  if (!email || !email.includes('@')) {
    alert('Por favor, informe um endereço de e-mail válido.');
    return;
  }

  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    alert('A senha deve conter exatamente 4 números (ex: 1234).');
    return;
  }

  try {
    const res = await fetch('/api/participants/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: pId,
        email,
        pin,
        wishlist
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.error}`);
      return;
    }

    // Fecha o modal com segurança usando os dados salvos em pName
    closeClaimModal();

    alert(`🎉 Perfeito, ${pName}!\n\nSeu e-mail (${email}) e sua senha de 4 dígitos foram cadastrados com sucesso!\n\nGuarde a sua senha para consultar seu amigo secreto quando o sorteio for realizado.`);
    
    await loadParticipants();
  } catch (err) {
    console.error('Erro no cadastro de e-mail:', err);
    alert('Erro ao confirmar cadastro. Verifique a conexão com o servidor.');
  }
}

// 7. MODAL: Participante Ver Amigo Secreto (Login com Senha de 4 Dígitos)
function openMyDrawModal(participantId) {
  const p = participants.find(item => item.id === participantId);
  if (!p) return;

  activeParticipantForLogin = p;

  document.getElementById('myDrawParticipantName').textContent = `Olá, ${p.name}!`;
  document.getElementById('myDrawPinInput').value = '';
  document.getElementById('myDrawErrorMsg').style.display = 'none';

  document.getElementById('myDrawLoginForm').style.display = 'block';
  document.getElementById('myDrawResultBox').style.display = 'none';
  document.getElementById('myDrawPendingBox').style.display = 'none';

  document.getElementById('myDrawModal').classList.add('active');
  document.getElementById('myDrawPinInput').focus();
}

function closeMyDrawModal() {
  document.getElementById('myDrawModal').classList.remove('active');
  activeParticipantForLogin = null;
}

async function submitMyDrawLogin() {
  if (!activeParticipantForLogin) return;

  const pin = document.getElementById('myDrawPinInput').value.trim();
  const errorMsg = document.getElementById('myDrawErrorMsg');

  if (!pin || pin.length !== 4) {
    errorMsg.textContent = 'Digite sua senha de 4 dígitos.';
    errorMsg.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/participant/my-draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeParticipantForLogin.id,
        pin
      })
    });

    const data = await res.json();
    if (!res.ok) {
      errorMsg.textContent = data.error || 'Senha incorreta.';
      errorMsg.style.display = 'block';
      return;
    }

    errorMsg.style.display = 'none';
    document.getElementById('myDrawLoginForm').style.display = 'none';

    if (data.drawCompleted) {
      document.getElementById('myDrawReceiverName').textContent = data.receiverName;

      const wishlistBox = document.getElementById('myDrawReceiverWishlistBox');
      const wishlistText = document.getElementById('myDrawReceiverWishlistText');
      if (data.receiverWishlist) {
        wishlistBox.style.display = 'block';
        wishlistText.textContent = data.receiverWishlist;
      } else {
        wishlistBox.style.display = 'none';
      }

      const eventInfoBox = document.getElementById('myDrawEventInfoBox');
      const ev = data.eventConfig || {};
      eventInfoBox.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 4px; color: var(--dark);">${escapeHtml(ev.eventName || 'Amigo Secreto')}</div>
        ${ev.suggestedBudget ? `<div>💰 <strong>Valor Sugerido:</strong> R$ ${escapeHtml(ev.suggestedBudget)}</div>` : ''}
        ${ev.eventDate ? `<div>📅 <strong>Data:</strong> ${escapeHtml(ev.eventDate)}</div>` : ''}
        ${ev.eventLocation ? `<div>📍 <strong>Local:</strong> ${escapeHtml(ev.eventLocation)}</div>` : ''}
      `;

      document.getElementById('myDrawResultBox').style.display = 'block';

    } else {
      document.getElementById('myDrawSavedEmail').textContent = data.participant.email || 'Não informado';
      document.getElementById('myDrawSavedWishlist').textContent = data.participant.wishlist || 'Nenhuma dica cadastrada';
      document.getElementById('myDrawPendingBox').style.display = 'block';
    }

  } catch (err) {
    errorMsg.textContent = 'Erro ao consultar amigo secreto.';
    errorMsg.style.display = 'block';
  }
}

// 8. MODAL: Inserir Vários Nomes de Uma Vez (Lote) - Organizador
function openBulkModal() {
  document.getElementById('bulkNamesText').value = '';
  document.getElementById('bulkDefaultFamily').value = '';
  document.getElementById('bulkModal').classList.add('active');
  document.getElementById('bulkNamesText').focus();
}

function closeBulkModal() {
  document.getElementById('bulkModal').classList.remove('active');
}

async function handleBulkImport() {
  const rawText = document.getElementById('bulkNamesText').value.trim();
  const defaultFamily = document.getElementById('bulkDefaultFamily').value.trim();

  if (!rawText) {
    alert('Por favor, digite ou cole pelo menos um nome.');
    return;
  }

  try {
    const res = await fetch('/api/participants/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: organizerPin,
        rawText,
        defaultFamily
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.error}`);
      return;
    }

    closeBulkModal();
    let msg = `${data.addedCount} novos participantes adicionados com sucesso!`;
    if (data.skippedCount > 0) {
      msg += `\n(${data.skippedCount} nomes foram ignorados por já estarem cadastrados: ${data.skippedNames.join(', ')})`;
    }
    alert(msg);
    await loadParticipants();
  } catch (err) {
    alert('Erro ao importar participantes.');
  }
}

// 9. MODAL: Adicionar 1 Participante Manual - Organizador
function openSingleAddModal() {
  document.getElementById('singleName').value = '';
  document.getElementById('singleFamily').value = '';
  document.getElementById('singleEmail').value = '';
  document.getElementById('singleAddModal').classList.add('active');
  document.getElementById('singleName').focus();
}

function closeSingleAddModal() {
  document.getElementById('singleAddModal').classList.remove('active');
}

async function handleSingleAddSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const name = document.getElementById('singleName').value.trim();
  const family = document.getElementById('singleFamily').value.trim();
  const email = document.getElementById('singleEmail').value.trim();

  try {
    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, family, email })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.error}`);
      return;
    }

    closeSingleAddModal();
    await loadParticipants();
  } catch (err) {
    alert('Erro ao cadastrar participante.');
  }
}

// 10. Remover Participante - Organizador
async function removeParticipant(id) {
  if (!confirm('Deseja realmente remover este participante?')) return;

  try {
    const res = await fetch(`/api/participants/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: organizerPin })
    });

    if (!res.ok) {
      const data = await res.json();
      alert(`Erro: ${data.error}`);
      return;
    }

    await loadParticipants();
  } catch (err) {
    alert('Erro ao excluir participante.');
  }
}

// 11. Limpar Todos os Participantes - Organizador
async function clearAllParticipants() {
  if (participants.length === 0) return;
  if (!confirm('Atenção: Tem certeza de que deseja apagar TODOS os participantes da lista?')) return;

  try {
    const res = await fetch('/api/participants/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: organizerPin })
    });

    if (!res.ok) {
      const data = await res.json();
      alert(`Erro: ${data.error}`);
      return;
    }

    await loadParticipants();
  } catch (err) {
    alert('Erro ao limpar participantes.');
  }
}

// 12. Carregar Dados de Exemplo - Organizador
async function loadSampleData() {
  try {
    const res = await fetch('/api/participants/sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: organizerPin })
    });

    if (!res.ok) {
      const data = await res.json();
      alert(`Erro: ${data.error}`);
      return;
    }

    await loadParticipants();
  } catch (err) {
    alert('Erro ao carregar exemplos.');
  }
}

// 13. Configurações de E-mail
function handleProviderChange() {
  const provider = document.getElementById('cfgProvider').value;
  const customFields = document.getElementById('customSmtpFields');
  const gmailAlert = document.getElementById('gmailHelperAlert');
  const emailUserGroup = document.getElementById('emailUserGroup');
  const emailPassGroup = document.getElementById('emailPassGroup');

  if (provider === 'custom') {
    customFields.style.display = 'grid';
    gmailAlert.style.display = 'none';
    emailUserGroup.style.display = 'flex';
    emailPassGroup.style.display = 'flex';
  } else if (provider === 'gmail') {
    customFields.style.display = 'none';
    gmailAlert.style.display = 'flex';
    emailUserGroup.style.display = 'flex';
    emailPassGroup.style.display = 'flex';
  } else if (provider === 'simulation') {
    customFields.style.display = 'none';
    gmailAlert.style.display = 'none';
    emailUserGroup.style.display = 'none';
    emailPassGroup.style.display = 'none';
  } else {
    customFields.style.display = 'none';
    gmailAlert.style.display = 'none';
    emailUserGroup.style.display = 'flex';
    emailPassGroup.style.display = 'flex';
  }
}

async function saveSettings() {
  const eventName = document.getElementById('cfgEventName').value;
  const suggestedBudget = document.getElementById('cfgBudget').value;
  const eventDate = document.getElementById('cfgDate').value;
  const eventLocation = document.getElementById('cfgLocation').value;
  const publicBaseUrl = document.getElementById('cfgPublicBaseUrl').value.trim();
  const newPin = document.getElementById('cfgPin').value.trim();

  const provider = document.getElementById('cfgProvider').value;
  const fromName = document.getElementById('cfgFromName').value;
  const user = document.getElementById('cfgUser').value;
  const pass = document.getElementById('cfgPass').value;

  const customHost = document.getElementById('cfgCustomHost').value;
  const customPort = document.getElementById('cfgCustomPort').value;
  const customSecure = document.getElementById('cfgCustomSecure').value === 'true';

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: organizerPin,
        organizerPin: newPin || organizerPin,
        eventName,
        suggestedBudget,
        eventDate,
        eventLocation,
        publicBaseUrl,
        emailSettings: {
          provider,
          fromName,
          user,
          pass,
          customHost,
          customPort,
          customSecure
        }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.error}`);
      return;
    }

    if (newPin) {
      organizerPin = newPin;
      localStorage.setItem('organizerPin', newPin);
    }

    alert('Configurações salvas com sucesso!');
    loadConfig();
  } catch (err) {
    alert('Erro ao salvar configurações.');
  }
}

// 14. Testar Conexão de E-mail
async function testEmailConnection() {
  const resultDiv = document.getElementById('testEmailResult');
  const userEmail = document.getElementById('cfgUser').value.trim();

  resultDiv.innerHTML = `<div class="alert alert-info">⏳ Enviando e-mail de teste para ${userEmail || 'seu endereço'}... aguarde alguns segundos.</div>`;

  try {
    const res = await fetch('/api/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: organizerPin,
        testRecipient: userEmail
      })
    });

    const data = await res.json();
    if (!res.ok) {
      resultDiv.innerHTML = `<div class="alert alert-error">❌ ${data.error}</div>`;
      return;
    }

    resultDiv.innerHTML = `<div class="alert alert-success">✅ ${data.message}</div>`;
  } catch (err) {
    resultDiv.innerHTML = `<div class="alert alert-error">❌ Falha de rede ao tentar enviar o teste de e-mail.</div>`;
  }
}

// 15. Checklist da Aba de Sorteio
function updateDrawChecklist() {
  const countElem = document.getElementById('checkCount');
  const claimedElem = document.getElementById('checkClaimed');
  const famElem = document.getElementById('checkFamily');
  const emailElem = document.getElementById('checkEmail');
  const drawBtn = document.getElementById('drawBtn');

  if (!countElem) return;

  let ok = true;

  if (participants.length >= 3) {
    countElem.innerHTML = `✅ <strong>${participants.length} participantes</strong> cadastrados (mínimo de 3 atingido).`;
    countElem.style.color = '#16a34a';
  } else {
    countElem.innerHTML = `❌ Apenas <strong>${participants.length}</strong> cadastrados (necessário pelo menos 3).`;
    countElem.style.color = '#dc2626';
    ok = false;
  }

  const claimedCount = participants.filter(hasRegisteredEmail).length;
  if (claimedCount === participants.length && participants.length > 0) {
    claimedElem.innerHTML = `✅ <strong>Todos os ${claimedCount} participantes</strong> já cadastraram e-mail e senha!`;
    claimedElem.style.color = '#16a34a';
  } else if (claimedCount > 0) {
    claimedElem.innerHTML = `ℹ️ <strong>${claimedCount} de ${participants.length}</strong> cadastraram e-mail. Os demais participantes poderão consultar quem tiraram no site com a senha de 4 dígitos.`;
    claimedElem.style.color = '#2563eb';
  } else {
    claimedElem.innerHTML = `⚠️ <strong>Nenhum dos ${participants.length} participantes</strong> cadastrou e-mail ainda.`;
    claimedElem.style.color = '#d97706';
  }

  const isValidFamily = validateFamilyConstraints();
  if (isValidFamily) {
    famElem.innerHTML = `✅ Nenhuma família tem mais de 50% dos membros. Sorteio viável!`;
    famElem.style.color = '#16a34a';
  } else {
    famElem.innerHTML = `❌ Uma família possui mais da metade dos participantes. Ajuste na lista.`;
    famElem.style.color = '#dc2626';
    ok = false;
  }

  const provider = document.getElementById('cfgProvider')?.value || config.provider;
  if (provider === 'simulation') {
    emailElem.innerHTML = `ℹ️ <strong>Modo Simulação ativado</strong> (não enviará e-mails reais).`;
    emailElem.style.color = '#2563eb';
  } else if (config.hasEmailConfigured) {
    emailElem.innerHTML = `✅ E-mail do remetente configurado.`;
    emailElem.style.color = '#16a34a';
  } else {
    emailElem.innerHTML = `⚠️ E-mail do remetente ainda não preenchido (ou ative o Modo Simulação).`;
    emailElem.style.color = '#d97706';
  }

  const activeDrawBanner = document.getElementById('activeDrawBanner');
  const activeDrawDateText = document.getElementById('activeDrawDateText');
  const cancelDrawBtn = document.getElementById('cancelDrawBtn');

  if (config.drawCompleted) {
    if (activeDrawBanner) {
      activeDrawBanner.style.display = 'flex';
      const dateFormatted = config.activeDrawDate ? new Date(config.activeDrawDate).toLocaleString('pt-BR') : 'Data recente';
      if (activeDrawDateText) activeDrawDateText.textContent = `Realizado em: ${dateFormatted}`;
    }
    if (cancelDrawBtn) cancelDrawBtn.style.display = 'inline-flex';
    if (drawBtn) drawBtn.textContent = '🎲 Realizar Novo Sorteio (Substituir Atual)';
  } else {
    if (activeDrawBanner) activeDrawBanner.style.display = 'none';
    if (cancelDrawBtn) cancelDrawBtn.style.display = 'none';
    if (drawBtn) drawBtn.textContent = '🚀 Realizar Sorteio e Enviar E-mails!';
  }

  if (drawBtn) {
    drawBtn.disabled = !ok;
    drawBtn.style.opacity = ok ? '1' : '0.5';
  }
}

// Cancelar Sorteio Ativo
async function cancelActiveDraw() {
  if (!confirm('⚠️ Tem certeza de que deseja CANCELAR o sorteio atual?\n\nOs participantes não verão mais quem tiraram no site (voltará para o status "Sorteio Pendente") até que você realize um novo sorteio.')) {
    return;
  }

  try {
    const res = await fetch('/api/draw/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: organizerPin })
    });

    const data = await res.json();
    alert('✅ Sorteio cancelado com sucesso!\n\nO status voltou para "Pendente" e ninguém mais vê o amigo secreto anterior.');
    await loadConfig();
    await loadParticipants();
    updateDrawChecklist();
    const progressBox = document.getElementById('drawProgressBox');
    if (progressBox) progressBox.style.display = 'none';
  } catch (err) {
    alert('Erro ao cancelar sorteio.');
  }
}

// 16. Executar Sorteio
async function handleExecuteDraw() {
  const isDryRun = document.getElementById('dryRunCheckbox').checked;
  const unclaimedCount = participants.filter(p => !p.claimed).length;

  let warning = '';
  if (unclaimedCount > 0) {
    warning = `\n\n⚠️ Atenção: ${unclaimedCount} participante(s) ainda não cadastraram e-mail. Eles não receberão e-mail, mas poderão consultar quem tiraram aqui no site digitando a senha de 4 dígitos.`;
  }

  const confirmMsg = isDryRun
    ? 'Deseja iniciar a SIMULAÇÃO do sorteio? (Nenhum e-mail real será disparado)'
    : `ATENÇÃO: Você está prestes a realizar o sorteio oficial e enviar os e-mails para todos os participantes!${warning}\n\nConfirmar sorteio agora?`;

  if (!confirm(confirmMsg)) return;

  const drawBtn = document.getElementById('drawBtn');
  const progressBox = document.getElementById('drawProgressBox');
  const summaryAlert = document.getElementById('drawSummaryAlert');
  const resultsList = document.getElementById('drawResultsList');

  drawBtn.disabled = true;
  drawBtn.textContent = '⏳ Realizando Sorteio & Enviando...';
  progressBox.style.display = 'block';
  summaryAlert.style.display = 'none';
  resultsList.innerHTML = '<div style="color: #64748b; padding: 10px;">Executando algoritmo e processando envio...</div>';

  try {
    const res = await fetch('/api/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: organizerPin,
        dryRun: isDryRun
      })
    });

    const data = await res.json();
    if (!res.ok) {
      summaryAlert.className = 'alert alert-error';
      summaryAlert.innerHTML = `❌ <strong>Erro no Sorteio:</strong> ${data.error}`;
      summaryAlert.style.display = 'flex';
      drawBtn.disabled = false;
      drawBtn.textContent = '🚀 Realizar Sorteio e Enviar E-mails!';
      return;
    }

    summaryAlert.className = 'alert alert-success';
    summaryAlert.innerHTML = `🎉 <strong>${data.message}</strong>`;
    summaryAlert.style.display = 'flex';

    resultsList.innerHTML = '';
    (data.results || []).forEach(r => {
      const item = document.createElement('div');
      let isSuccess = r.status === 'enviado' || r.status === 'simulado';
      let badgeText = isSuccess ? '✅ Entregue' : (r.status === 'pendente_email' ? '🟡 Consulta no Site' : `❌ ${r.error || 'Erro'}`);
      let badgeClass = isSuccess ? 'success' : (r.status === 'pendente_email' ? 'warning' : 'error');

      item.className = `result-item ${isSuccess ? 'success' : (r.status === 'pendente_email' ? '' : 'error')}`;
      item.innerHTML = `
        <div>
          <strong>${escapeHtml(r.name)}</strong>
          <span style="color: #64748b; font-size: 0.85rem; margin-left: 6px;">(${escapeHtml(r.email)})</span>
        </div>
        <div class="result-badge ${badgeClass}">
          ${badgeText}
        </div>
      `;
      resultsList.appendChild(item);
    });

  } catch (err) {
    summaryAlert.className = 'alert alert-error';
    summaryAlert.innerHTML = `❌ Erro inesperado ao realizar sorteio.`;
    summaryAlert.style.display = 'flex';
  } finally {
    drawBtn.disabled = false;
    drawBtn.textContent = '🚀 Realizar Novo Sorteio';
  }
}

// 17. Histórico e Gabarito de Emergência
async function loadDrawHistory() {
  const container = document.getElementById('historyContainer');
  if (!container) return;
  container.innerHTML = '<p style="color: #64748b;">Carregando histórico do servidor...</p>';

  try {
    const res = await fetch('/api/draw/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: organizerPin })
    });

    const data = await res.json();
    if (!res.ok) {
      container.innerHTML = `<div class="alert alert-error">❌ ${data.error}</div>`;
      return;
    }

    const history = data.history || [];
    if (history.length === 0) {
      container.innerHTML = `<p style="color: #64748b; font-style: italic;">Nenhum sorteio foi realizado ainda.</p>`;
      return;
    }

    container.innerHTML = '';
    history.forEach((record, idx) => {
      const dateStr = new Date(record.date).toLocaleString('pt-BR');
      const box = document.createElement('div');
      box.className = 'step-box';
      box.style.marginBottom = '20px';

      let rowsHtml = '';
      (record.pairs || []).forEach((pair, pIdx) => {
        const secretId = `secret-${record.id}-${pIdx}`;
        rowsHtml += `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px 14px; font-weight: 700; color: #1e293b;">
              👤 ${escapeHtml(pair.giverName)}
            </td>
            <td style="padding: 12px 14px; color: #64748b; font-size: 0.9rem;">
              ${escapeHtml(pair.giverEmail || '(Sem e-mail)')}
            </td>
            <td style="padding: 12px 14px; text-align: center; color: #16a34a; font-weight: bold;">
              ➜ tirou ➜
            </td>
            <td style="padding: 12px 14px;" id="${secretId}">
              <button class="btn btn-outline btn-sm secret-reveal-btn" onclick="revealSingleSecret('${secretId}', '${escapeJs(pair.receiverName)}')">
                👁️ Revelar Amigo
              </button>
            </td>
          </tr>
        `;
      });

      box.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <h4 style="margin: 0;">Sorteio #${history.length - idx} - ${dateStr}</h4>
          <span style="font-size: 0.85rem; background: #e2e8f0; padding: 4px 10px; border-radius: 12px; font-weight: 600;">
            ${record.isSimulation ? 'Simulação' : 'Oficial'} • ${record.totalParticipants} participantes
          </span>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr style="background: #f1f5f9;">
                <th>Quem Tirou</th>
                <th>E-mail</th>
                <th style="text-align: center;">Ação</th>
                <th>Amigo Secreto Sorteado</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
      container.appendChild(box);
    });

  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Erro ao carregar histórico.</div>`;
  }
}

function revealSingleSecret(elementId, receiverName) {
  const cell = document.getElementById(elementId);
  if (!cell) return;
  cell.innerHTML = `
    <div style="display: inline-flex; align-items: center; gap: 8px;">
      <strong style="color: #166534; font-size: 1rem; background: #dcfce7; padding: 5px 12px; border-radius: 6px; border: 1.5px solid #86efac; letter-spacing: 0.5px;">
        🎉 ${escapeHtml(receiverName)}
      </strong>
      <button class="btn btn-sm btn-outline" style="padding: 3px 8px; font-size: 0.78rem;" title="Ocultar nome novamente" onclick="hideSingleSecret('${elementId}', '${escapeJs(receiverName)}')">
        🔒 Ocultar
      </button>
    </div>
  `;
}

function hideSingleSecret(elementId, receiverName) {
  const cell = document.getElementById(elementId);
  if (!cell) return;
  cell.innerHTML = `
    <button class="btn btn-outline btn-sm secret-reveal-btn" onclick="revealSingleSecret('${elementId}', '${escapeJs(receiverName)}')">
      👁️ Revelar Amigo
    </button>
  `;
}

function hideAllSecrets() {
  loadDrawHistory();
}

function escapeJs(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function resetActiveDraw() {
  if (!confirm('Deseja realmente resetar o sorteio ativo? Os participantes não poderão mais consultar o amigo secreto anterior até que você faça um novo sorteio.')) return;

  try {
    const res = await fetch('/api/draw/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: organizerPin })
    });

    const data = await res.json();
    alert(data.message || 'Sorteio resetado.');
    loadConfig();
    loadDrawHistory();
  } catch (err) {
    alert('Erro ao resetar sorteio.');
  }
}

// 18. Modais Gerais e Utilitários
function openShareModal() {
  document.getElementById('shareModal').classList.add('active');
}

function closeShareModal() {
  document.getElementById('shareModal').classList.remove('active');
}

function toggleOrganizerModal() {
  document.getElementById('authModal').classList.toggle('active');
  const input = document.getElementById('organizerPinInput');
  if (input) {
    input.value = organizerPin;
    input.focus();
  }
}

async function verifyOrganizerPin() {
  const pin = document.getElementById('organizerPinInput').value.trim();
  const errorDiv = document.getElementById('authErrorMsg');

  try {
    const res = await fetch('/api/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });

    const data = await res.json();
    if (!res.ok) {
      errorDiv.textContent = data.error || 'PIN incorreto.';
      errorDiv.style.display = 'block';
      return;
    }

    organizerPin = pin;
    localStorage.setItem('organizerPin', pin);
    isOrganizerLoggedIn = true;
    localStorage.setItem('isOrganizerLoggedIn', 'true');

    errorDiv.style.display = 'none';
    toggleOrganizerModal();
    updateOrganizerView();
    loadParticipants();

    // Rola suavemente até o painel do organizador
    setTimeout(() => {
      document.getElementById('organizerSection')?.scrollIntoView({ behavior: 'smooth' });
    }, 200);

  } catch (err) {
    errorDiv.textContent = 'Erro de conexão com o servidor.';
    errorDiv.style.display = 'block';
  }
}

function copyShareLink() {
  const link = document.getElementById('shareUrlInput').value;
  navigator.clipboard.writeText(link).then(() => {
    alert(`Link copiado com sucesso!\n\nEnvie este link no WhatsApp para todos os participantes:\n${link}`);
  }).catch(() => {
    prompt('Copie o link abaixo:', link);
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert(`Comando copiado para a área de transferência:\n${text}`);
  });
}

function escapeHtml(string) {
  if (!string) return '';
  const div = document.createElement('div');
  div.innerText = string;
  return div.innerHTML;
}
