import { closeDatabase, db } from '../db.js';
import { isQaMode } from '../config.js';
import { hashPassword } from '../security/password.js';

if (!isQaMode) throw new Error('qa-seed só pode ser executado com QA_MODE=true');
const qaPassword = process.env.QA_E2E_PASSWORD ?? '';
if (!qaPassword) throw new Error('qa-seed exige QA_E2E_PASSWORD gerada pelo runner QA; nenhuma credencial fixa é aceita.');

async function seed() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE companies RESTART IDENTITY CASCADE');

    const companyA = (await client.query<{ id: string }>('INSERT INTO companies (name) VALUES ($1) RETURNING id', ['Vitstock QA A'])).rows[0]!.id;
    const companyB = (await client.query<{ id: string }>('INSERT INTO companies (name) VALUES ($1) RETURNING id', ['Vitstock QA B'])).rows[0]!.id;
    const adminHash = await hashPassword(qaPassword);
    const attendantHash = await hashPassword(qaPassword);
    const adminA = (await client.query<{ id: string }>(`INSERT INTO users (company_id, name, email, password_hash, role, must_change_password) VALUES ($1, 'QA Admin A', 'qa-admin-a@vitstock.test', $2, 'admin', false) RETURNING id`, [companyA, adminHash])).rows[0]!.id;
    await client.query(`
      INSERT INTO users (company_id, name, email, password_hash, role, active, must_change_password)
      VALUES ($1, 'E2E Preview Admin', 'e2e-preview@vitstock.test', $2, 'admin', true, false)
      ON CONFLICT (company_id, email) DO UPDATE
      SET role = 'admin'
    `, [companyA, adminHash]);
    await client.query(`INSERT INTO users (company_id, name, email, password_hash, role, must_change_password) VALUES ($1, 'QA Operacional A', 'qa-operational-a@vitstock.test', $2, 'attendant', false)`, [companyA, attendantHash]);
    await client.query(`INSERT INTO users (company_id, name, email, password_hash, role, must_change_password) VALUES ($1, 'Fernanda QA', 'qa-fernanda@vitstock.test', $2, 'attendant', false)`, [companyA, attendantHash]);
    await client.query(`INSERT INTO users (company_id, name, email, password_hash, role, must_change_password) VALUES ($1, 'QA Admin B', 'qa-admin-b@vitstock.test', $2, 'admin', false)`, [companyB, adminHash]);

    const addContact = async (companyId: string, name: string, phone: string, extra: Record<string, unknown> = {}) => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO contacts (company_id, name, phone, email, company, notes, source, cpf, address, birthday, job_title, website, google_resource_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [companyId, name, phone, extra.email || null, extra.company || null, extra.notes || null, extra.source || 'system', extra.cpf || null, extra.address || null, extra.birthday || null, extra.jobTitle || null, extra.website || null, extra.googleResourceName || null],
      );
      const id = row.rows[0]!.id;
      await client.query(`INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source) VALUES ($1, $2, $3, $4, true, $5)`, [companyId, id, phone, phone.replace(/\D/g, ''), extra.source || 'system']);
      if (extra.email) await client.query(`INSERT INTO contact_emails (company_id, contact_id, email, normalized_email, is_primary, source) VALUES ($1, $2, $3, $4, true, 'system')`, [companyId, id, extra.email, String(extra.email).toLowerCase()]);
      return id;
    };
    const addPhone = async (companyId: string, contactId: string, phone: string, primary = false) => client.query(`INSERT INTO contact_phones (company_id, contact_id, phone, normalized_phone, is_primary, source) VALUES ($1, $2, $3, $4, $5, 'system')`, [companyId, contactId, phone, phone.replace(/\D/g, ''), primary]);
    const addConversation = async (companyId: string, contactId: string, remoteJid: string, content: string, isGroup = false) => {
      const row = await client.query<{ id: string }>(`INSERT INTO conversations (company_id, contact_id, evolution_remote_jid, is_group, group_name, last_message, last_message_at, unread_count) VALUES ($1, $2, $3, $4, $5, $6, now(), 1) RETURNING id`, [companyId, contactId, remoteJid, isGroup, isGroup ? 'Grupo QA' : null, content]);
      const conversationId = row.rows[0]!.id;
      await client.query(`INSERT INTO messages (company_id, conversation_id, evolution_message_id, sender, sender_name, content, status, sent_at) VALUES ($1, $2, $3, 'contact', 'Cliente QA', $4, 'delivered', now() - interval '2 minutes')`, [companyId, conversationId, `qa-seed-${remoteJid}`.replace(/[^a-zA-Z0-9_-]/g, '_'), content]);
      await client.query(`INSERT INTO contact_channel_identities (company_id, contact_id, channel, identity, identity_type) VALUES ($1, $2, 'whatsapp', $3, $4)`, [companyId, contactId, remoteJid, remoteJid.endsWith('@lid') ? 'lid' : remoteJid.endsWith('@g.us') ? 'group' : 'remote_jid']);
      return conversationId;
    };

    const ana = await addContact(companyA, 'Ana QA', '5521990000001', { email: 'ana.qa@example.test', company: 'Empresa QA', notes: 'Contato Google fictício', source: 'google', googleResourceName: 'people/qa-ana', cpf: '000.000.000-01', address: 'Rua QA, 100', birthday: '1990-05-10', jobTitle: 'Compradora', website: 'https://example.test/qa-ana' });
    await addPhone(companyA, ana, '5521990000099');
    const anaConversation = await addConversation(companyA, ana, '5521990000001@s.whatsapp.net', 'Olá, preciso de uma cotação QA.');
    await addConversation(companyA, ana, '164700000001@lid', 'Mensagem na identidade LID QA.');

    const multi = await addContact(companyA, 'Contato QA com dois números', '5521990000002', { email: 'multi.qa@example.test' });
    await addPhone(companyA, multi, '55219900000022');
    await addConversation(companyA, multi, '5521990000002@s.whatsapp.net', 'Thread do telefone principal.');
    await addConversation(companyA, multi, '5521990000022@s.whatsapp.net', 'Thread do telefone secundário.');

    const duplicate = await addContact(companyA, 'Contato QA Duplicado', '5521990000003');
    await addPhone(companyA, duplicate, '5521990000001');
    const sharedA = await addContact(companyA, 'Empresa QA Compartilhada A', '5521990000004');
    const sharedB = await addContact(companyA, 'Empresa QA Compartilhada B', '5521990000005');
    await addPhone(companyA, sharedA, '5521990000006');
    await addPhone(companyA, sharedB, '5521990000006');
    const archived = await addContact(companyA, 'Contato QA Arquivado', '5521990000007', { notes: 'Permanece arquivado quando recebe novas mensagens.' });
    await addConversation(companyA, archived, '5521990000007@s.whatsapp.net', 'Histórico anterior do contato arquivado.');
    await client.query(`UPDATE contacts SET archived_at = now(), archived_by = $2 WHERE id = $1`, [archived, adminA]);
    const avatarValid = await addContact(companyA, 'Contato QA Avatar Válido', '5521990000011', { avatarUrl: 'http://localhost:3001/api/qa/avatar/valid.svg' });
    await client.query('UPDATE contacts SET avatar_url = $2 WHERE id = $1', [avatarValid, 'http://localhost:3001/api/qa/avatar/valid.svg']);
    await addConversation(companyA, avatarValid, '5521990000011@s.whatsapp.net', 'Avatar local válido para QA.');
    const avatarBroken = await addContact(companyA, 'Contato QA Avatar Quebrado', '5521990000012', { avatarUrl: 'http://localhost:3001/api/qa/avatar/broken.svg' });
    await client.query('UPDATE contacts SET avatar_url = $2 WHERE id = $1', [avatarBroken, 'http://localhost:3001/api/qa/avatar/broken.svg']);
    await addConversation(companyA, avatarBroken, '5521990000012@s.whatsapp.net', 'Avatar quebrado esperado para QA.');
    const avatarMissing = await addContact(companyA, 'Contato QA Avatar Ausente', '5521990000013');
    await addConversation(companyA, avatarMissing, '5521990000013@s.whatsapp.net', 'Avatar ausente para QA.');
    const group = await addContact(companyA, 'Grupo QA (fora de Contatos)', '120363000000@g.us');
    await addConversation(companyA, group, '120363000000@g.us', 'Mensagem de grupo QA.', true);

    await client.query(
      `INSERT INTO quick_replies (company_id, scope, shortcut, title, body, position)
       VALUES
         ($1, 'COMPANY', '/proposta', 'Proposta Comercial PIX', 'Segue a proposta comercial para o lote com 5% de desconto no PIX: R$ 58.995,00.', 0),
         ($1, 'COMPANY', '/frete', 'Prazo de Entrega', 'O prazo de entrega para Curitiba é de 2 a 3 dias úteis após a confirmação do pagamento.', 1)`,
      [companyA],
    );

    // Massa suficiente para validar paginação, busca e ordenação sem alterar
    // os fixtures especiais usados pelos cenários funcionais.
    for (let index = 1; index <= 65; index += 1) {
      await addContact(companyA, `Contato QA Página ${String(index).padStart(2, '0')}`, `552199100${String(index).padStart(4, '0')}`);
    }

    const tagVip = (await client.query<{ id: string }>(`INSERT INTO contact_tags (company_id, name, color) VALUES ($1, 'QA VIP', '#EABB19') RETURNING id`, [companyA])).rows[0]!.id;
    const tagImport = (await client.query<{ id: string }>(`INSERT INTO contact_tags (company_id, name, color) VALUES ($1, 'QA Importação', '#3B82F6') RETURNING id`, [companyA])).rows[0]!.id;
    await client.query(`INSERT INTO contact_tag_links (company_id, contact_id, tag_id) VALUES ($1, $2, $3), ($1, $4, $5)`, [companyA, ana, tagVip, multi, tagImport]);

    const conversationTagNames = [
      ['Tráfego', '#F97316', 'traffic'],
      ['VIP Atendimento', '#EABB19', null],
      ['Retorno', '#3B82F6', null],
      ['Orçamento', '#10B981', null],
      ['Pós-venda', '#A78BFA', null],
      ['Prioridade', '#EF4444', null],
      ['Indicação', '#EC4899', null],
      ['Aguardando cliente', '#64748B', null],
    ] as const;
    const conversationTagIds: string[] = [];
    for (const [name, color, systemKey] of conversationTagNames) {
      const tag = (await client.query<{ id: string }>(
        `INSERT INTO conversation_tags (company_id, name, color, system_key) VALUES ($1, $2, $3, $4) RETURNING id`,
        [companyA, name, color, systemKey],
      )).rows[0]!.id;
      conversationTagIds.push(tag);
    }
    await client.query(
      `INSERT INTO conversation_tag_links (company_id, conversation_id, tag_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
      [companyA, anaConversation, conversationTagIds[0], conversationTagIds[1]],
    );
    await client.query(
      `UPDATE messages SET metadata = jsonb_build_object('trafficSource', 'qa_campaign') WHERE conversation_id = $1`,
      [anaConversation],
    );
    await client.query(`INSERT INTO google_connections (company_id, google_email, refresh_token_encrypted, access_token_encrypted, access_token_expires_at, scopes) VALUES ($1, 'qa-google@example.test', 'qa-refresh-token', 'qa-access-token', now() + interval '1 day', ARRAY['qa-mock'])`, [companyA]);

    const tenantBContact = await addContact(companyB, 'Contato QA Tenant B', '5521988000001', { email: 'tenant-b@example.test' });
    await addConversation(companyB, tenantBContact, '5521988000001@s.whatsapp.net', 'Dados exclusivos do Tenant B.');
    await client.query('COMMIT');
    console.log('Massa QA determinística criada.');
    console.log('Credencial QA efêmera disponibilizada pelo runner local.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

seed().then(() => closeDatabase()).catch(async (error) => { console.error('Falha no seed QA:', error); await closeDatabase(); process.exitCode = 1; });
