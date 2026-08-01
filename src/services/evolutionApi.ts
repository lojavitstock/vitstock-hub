import { WhatsappInstance, Conversation, Message } from '../types';
import { mockInstances, mockConversations } from './mockData';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_EVOLUTION_API_URL ? import.meta.env.VITE_EVOLUTION_API_URL : '/evolution-api';
const API_KEY = import.meta.env.VITE_EVOLUTION_API_KEY || 'vitstock_global_key_2026';
const USE_MOCK = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export class EvolutionApiService {
  /**
   * Buscar status da conexão da instância
   */
  static async getInstanceStatus(instanceName: string): Promise<WhatsappInstance> {
    if (USE_MOCK) {
      return mockInstances[0];
    }

    try {
      // 1. Consultar fetchInstances para verificar disconnectionAt e disconnectionReasonCode
      const fetchRes = await fetch(`${API_URL}/instance/fetchInstances`, {
        headers: { 'apikey': API_KEY }
      });
      
      let fetchedInst: any = null;
      if (fetchRes.ok) {
        const instances = await fetchRes.json();
        if (Array.isArray(instances)) {
          fetchedInst = instances.find((i: any) => i.name === instanceName || i.instanceName === instanceName);
        }
      }

      // Se connectionStatus for open no fetchInstances, o WhatsApp está pareado!
      if (fetchedInst && fetchedInst.connectionStatus === 'open') {
        const rawOwner = fetchedInst.ownerJid || '';
        const cleanPhone = rawOwner.split('@')[0];
        return {
          id: instanceName,
          name: instanceName,
          status: 'connected',
          profileName: fetchedInst.profileName || 'Vitstock WhatsApp',
          phone: cleanPhone ? `+${cleanPhone}` : ''
        };
      }

      // Se houver registro de desconexão recente ou status close/connecting
      if (fetchedInst && (fetchedInst.connectionStatus === 'close' || fetchedInst.connectionStatus === 'connecting')) {
        return {
          id: instanceName,
          name: instanceName,
          status: 'disconnected',
          phone: fetchedInst.ownerJid ? fetchedInst.ownerJid.split('@')[0] : ''
        };
      }

      // Fallback: Checar a rota de connectionState
      const res = await fetch(`${API_URL}/instance/connectionState/${instanceName}`, {
        headers: { 'apikey': API_KEY }
      });
      if (!res.ok) {
        return await this.createInstance(instanceName);
      }
      const data = await res.json();
      const state = data?.instance?.state || data?.state;

      return {
        id: instanceName,
        name: instanceName,
        status: state === 'open' ? 'connected' : 'disconnected',
        phone: data?.instance?.owner || (fetchedInst?.ownerJid ? fetchedInst.ownerJid.split('@')[0] : '')
      };
    } catch (err) {
      console.warn('Evolution API indisponível ou em criação:', err);
      return {
        id: instanceName,
        name: instanceName,
        status: 'disconnected'
      };
    }
  }

  /**
   * Criar nova instância na Evolution API v2
   */
  static async createInstance(instanceName: string): Promise<WhatsappInstance> {
    if (USE_MOCK) return mockInstances[0];

    try {
      const res = await fetch(`${API_URL}/instance/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({
          instanceName,
          token: API_KEY,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        })
      });
      const data = await res.json();
      const qr = data?.qrcode?.base64 || data?.base64 || data?.code;
      return {
        id: instanceName,
        name: instanceName,
        status: 'disconnected',
        qrCodeUrl: qr
      };
    } catch (err) {
      console.error('Erro ao criar instância:', err);
      return {
        id: instanceName,
        name: instanceName,
        status: 'disconnected'
      };
    }
  }

  /**
   * Obter QR Code real para conectar WhatsApp
   */
  static async getConnectQrCode(instanceName: string): Promise<string | null> {
    if (USE_MOCK) return null;

    try {
      const res = await fetch(`${API_URL}/instance/connect/${instanceName}`, {
        headers: { 'apikey': API_KEY }
      });
      const data = await res.json();
      return data?.base64 || data?.qrcode?.base64 || data?.code || null;
    } catch (err) {
      console.error('Erro ao buscar QR Code:', err);
      return null;
    }
  }

  /**
   * Buscar conversas reais (Tentando Supabase primeiro, depois Evolution API)
   */
  static async fetchRealChats(instanceName: string): Promise<Conversation[]> {
    if (USE_MOCK) return mockConversations;

    try {
      // 1. Tenta buscar conversas gravadas no Supabase
      const { data: supaConversations, error } = await supabase
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && supaConversations && supaConversations.length > 0) {
        return supaConversations.map(c => ({
          id: c.id,
          contact: {
            id: c.id,
            name: c.contact_name || c.contact_phone || 'Contato',
            phone: c.contact_phone || '',
            avatar: c.contact_avatar || '',
            tags: [{ id: 't-supa', name: 'WhatsApp', color: '#10B981' }],
            createdAt: c.created_at ? c.created_at.split('T')[0] : new Date().toISOString().split('T')[0]
          },
          lastMessage: c.last_message || 'Conversa iniciada',
          lastMessageTimestamp: c.last_message_timestamp || 'Hoje',
          unreadCount: c.unread_count || 0,
          status: c.status || 'open',
          department: c.department || 'Atendimento Geral'
        }));
      }

      // 2. Fallback para Evolution API se não houver dados no Supabase ainda
      console.log(`[EvolutionAPI] Buscando conversas para a instância: ${instanceName}`);
      let rawData: any[] = [];

      const resChats = await fetch(`${API_URL}/chat/findChats/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({})
      });

      if (resChats.ok) {
        const chats = await resChats.json();
        if (Array.isArray(chats) && chats.length > 0) rawData = chats;
      }

      if (rawData.length === 0) {
        const resContacts = await fetch(`${API_URL}/chat/findContacts/${instanceName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY
          },
          body: JSON.stringify({})
        });

        if (resContacts.ok) {
          const contacts = await resContacts.json();
          if (Array.isArray(contacts) && contacts.length > 0) {
            rawData = contacts.filter((c: any) => c.id && (c.id.includes('@s.whatsapp.net') || c.id.includes('@c.us')));
          }
        }
      }

      if (rawData.length === 0) return [];

      return rawData.map((item: any, index: number) => {
        const jid = item.id || item.remoteJid || `chat-${index}`;
        const cleanNumber = jid.split('@')[0];
        const displayName = item.name || item.pushName || item.verifiedName || item.shortName || cleanNumber;

        return {
          id: jid,
          contact: {
            id: jid,
            name: displayName,
            phone: cleanNumber ? `+${cleanNumber}` : '',
            avatar: item.profilePicUrl || item.profilePictureUrl || '',
            tags: [{ id: 't-real', name: 'WhatsApp', color: '#10B981' }],
            createdAt: new Date().toISOString().split('T')[0]
          },
          lastMessage: item.lastMessage?.message?.conversation || 
                       item.lastMessage?.message?.extendedTextMessage?.text || 
                       'Conversa iniciada',
          lastMessageTimestamp: item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Hoje',
          unreadCount: item.unreadCount || 0,
          status: 'open',
          department: 'Atendimento Geral'
        };
      });
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao carregar chats/contatos:', err);
      return [];
    }
  }

  /**
   * Enviar mensagem de texto via WhatsApp + Salvar no Supabase
   */
  static async sendTextMessage(instanceName: string, number: string, text: string) {
    if (USE_MOCK) {
      console.log(`[MOCK EVOLUTION API] Enviar para ${number}: "${text}"`);
      return { status: 'SUCCESS', messageId: `msg-${Date.now()}` };
    }

    const cleanNumber = number.replace(/\D/g, '');
    const jid = `${cleanNumber}@s.whatsapp.net`;
    const timestampStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Salva ou atualiza a conversa e a mensagem no Supabase
    try {
      await supabase.from('conversations').upsert({
        id: jid,
        contact_phone: `+${cleanNumber}`,
        last_message: text,
        last_message_timestamp: timestampStr,
        status: 'open'
      });

      await supabase.from('messages').insert({
        id: `msg-${Date.now()}`,
        conversation_id: jid,
        sender: 'attendant',
        sender_name: 'Leo Vitorino',
        content: text,
        timestamp: timestampStr,
        status: 'sent'
      });
    } catch (err) {
      console.warn('Erro ao persisitir mensagem no Supabase:', err);
    }

    // 2. Dispara a mensagem no WhatsApp real via Evolution API
    try {
      const res = await fetch(`${API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({
          number: cleanNumber,
          text: text,
          delay: 1200,
          linkPreview: true
        })
      });

      const responseData = await res.json();
      console.log('[EvolutionAPI] Resposta do envio real:', responseData);
      return responseData;
    } catch (err) {
      console.error('[EvolutionAPI] Erro ao enviar mensagem:', err);
      return null;
    }
  }


  /**
   * Buscar histórico de mensagens de uma conversa/contato
   */
  static async fetchMessages(instanceName: string, remoteJid: string): Promise<Message[]> {
    if (USE_MOCK) return [];

    try {
      const cleanJid = remoteJid.includes('@') ? remoteJid : `${remoteJid.replace(/\D/g, '')}@s.whatsapp.net`;

      // 1. Tenta carregar mensagens do Supabase primeiro
      const { data: supaMsgs, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', cleanJid)
        .order('created_at', { ascending: true });

      if (!error && supaMsgs && supaMsgs.length > 0) {
        return supaMsgs.map(m => ({
          id: m.id,
          conversationId: m.conversation_id,
          sender: m.sender as 'attendant' | 'contact',
          senderName: m.sender_name || 'Atendente',
          content: m.content || '',
          timestamp: m.timestamp || 'Agora',
          status: m.status || 'sent',
          isInternalNote: m.is_internal_note || false
        }));
      }

      // 2. Fallback para Evolution API se não houver histórico gravado no Supabase
      const res = await fetch(`${API_URL}/chat/findMessages/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY
        },
        body: JSON.stringify({
          where: {
            key: {
              remoteJid: cleanJid
            }
          },
          limit: 50
        })
      });

      if (!res.ok) return [];
      const data = await res.json();
      const rawMsgs = data?.records || data?.messages || (Array.isArray(data) ? data : []);

      if (!Array.isArray(rawMsgs)) return [];

      return rawMsgs.map((m: any, idx: number) => {
        const fromMe = m.key?.fromMe ?? false;
        const msgContent = 
          m.message?.conversation || 
          m.message?.extendedTextMessage?.text || 
          m.message?.imageMessage?.caption || 
          '[Mídia/Anexo]';

        const timestampStr = m.messageTimestamp 
          ? new Date(Number(m.messageTimestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Agora';

        const senderType: 'attendant' | 'contact' = fromMe ? 'attendant' : 'contact';
        return {
          id: m.key?.id || `real-msg-${idx}`,
          conversationId: remoteJid,
          sender: senderType,
          senderName: fromMe ? 'Atendente' : (m.pushName || 'Contato'),
          content: msgContent,
          timestamp: timestampStr,
          status: 'read' as const
        };
      }).reverse();
    } catch (err) {
      console.warn('Erro ao buscar mensagens:', err);
      return [];
    }
  }
}

